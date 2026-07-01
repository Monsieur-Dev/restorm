/**
 * Service for importing WADL (Web Application Description Language) files
 * into Restorm collections.
 *
 * WADL is the old Sun / Oracle XML REST description format — still emitted by
 * some legacy JAX-RS services. Unlike WSDL/EDMX (flat operation lists), a
 * WADL document is a genuine tree: `<resource>` elements nest arbitrarily, so
 * a lazy-regex tag matcher (the trick `SoapImportService` / `ODataImportService`
 * use) breaks on the first nested resource. We parse with `fast-xml-parser`
 * instead and walk the resulting object tree recursively.
 *
 * Mapping: `<resources base="...">` → the environment's `baseUrl`,
 * `<resource path="...">` → a `Folder` (recursively, one per nesting level),
 * `<method name="GET" id="getUser">` → an `HTTPRequest`. `<param style="…">`
 * elements become query params / path params / headers depending on their
 * `style`. `<grammars>` inline XSD `<element>`/`<complexType>` declarations
 * become simple `ApiDocumentation` models; external schema references
 * (`<include href>` / `<import schemaLocation>`) are only noted, never
 * resolved — see `docs/imports/wadl.md`.
 */

import { XMLParser, XMLValidator } from 'fast-xml-parser'
import {
  Folder,
  EnvironmentFolder,
  Environment,
  HTTPRequest,
  type HTTPRequestBody
} from '../../../shared/models'
import { createTypedKeyValue } from '../../../shared/utils/createTypedKeyValue'
import type { ApiDocumentation, ModelDocumentation, OperationDocumentation } from '../../../shared/types/apiDocumentation'
import { toHTTPMethod } from './httpMethodValidator'
import { stableImportId as generateId } from './stableImportId'
import { CURRENT_FILE_FORMAT_VERSION } from '../../../shared/config/fileFormatVersion'

const ATTR_PREFIX = '@_'

/** Tags that may repeat at the same nesting level — always force an array so
 * the walker never has to special-case "one vs many". */
const ARRAY_TAGS = new Set(['resources', 'resource', 'method', 'param', 'representation', 'response'])

// ============================================================================
// Raw parsed-tree helpers
// ============================================================================

type RawNode = Record<string, unknown>

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** WADL/XSD `<doc>` elements are either a bare string (no attributes) or
 * `{ '#text': string, '@_...': ... }` once they carry e.g. `xml:lang`. */
function nonEmpty(text: string | undefined): string | undefined {
  const trimmed = text?.trim()
  return trimmed !== undefined && trimmed !== '' ? trimmed : undefined
}

function docText(node: unknown): string | undefined {
  const first: unknown = Array.isArray(node) ? (node as unknown[])[0] : node
  if (typeof first === 'string') return nonEmpty(first)
  if (first !== null && typeof first === 'object') {
    return nonEmpty(asString((first as RawNode)['#text']))
  }
  return undefined
}

// ============================================================================
// WADL tree — parsed shapes
// ============================================================================

interface WadlParam {
  name: string
  style: string
  type?: string
  required: boolean
  defaultValue?: string
}

interface WadlMethod {
  verb: string
  operationId?: string
  summary?: string
  params: WadlParam[]
  requestMediaTypes: string[]
  responseMediaTypes: string[]
}

interface WadlResource {
  path: string
  params: WadlParam[]
  methods: WadlMethod[]
  children: WadlResource[]
}

interface WadlGrammarModel {
  name: string
  properties: { name: string; type: string; required: boolean }[]
}

interface ParsedWadl {
  base: string
  title?: string
  roots: WadlResource[]
  models: WadlGrammarModel[]
  externalSchemaRefs: string[]
}

// ============================================================================
// Parser functions
// ============================================================================

function parseParamNode(raw: RawNode): WadlParam {
  const name = asString(raw[`${ATTR_PREFIX}name`]) ?? ''
  const style = asString(raw[`${ATTR_PREFIX}style`]) ?? 'plain'
  const type = asString(raw[`${ATTR_PREFIX}type`])
  const defaultValue = asString(raw[`${ATTR_PREFIX}default`])
  // Template params are positionally mandatory (they're part of the URL) even
  // when the source WADL omits the `required` attribute.
  const required = raw[`${ATTR_PREFIX}required`] === 'true' || style === 'template'
  return {
    name,
    style,
    ...(type !== undefined ? { type } : {}),
    required,
    ...(defaultValue !== undefined ? { defaultValue } : {})
  }
}

function parseMethodNode(raw: RawNode): WadlMethod {
  const verb = (asString(raw[`${ATTR_PREFIX}name`]) ?? 'GET').toUpperCase()
  const operationId = asString(raw[`${ATTR_PREFIX}id`])
  const summary = docText(raw['doc'])
  const request = raw['request'] as RawNode | undefined
  const params = toArray(request?.['param'] as RawNode[] | RawNode | undefined).map(parseParamNode)
  const requestMediaTypes = toArray(request?.['representation'] as RawNode[] | RawNode | undefined)
    .map((r) => asString(r[`${ATTR_PREFIX}mediaType`]))
    .filter((m): m is string => m !== undefined)
  const responseMediaTypes = toArray(raw['response'] as RawNode[] | RawNode | undefined)
    .flatMap((r) => toArray(r['representation'] as RawNode[] | RawNode | undefined))
    .map((r) => asString(r[`${ATTR_PREFIX}mediaType`]))
    .filter((m): m is string => m !== undefined)
  return {
    verb,
    ...(operationId !== undefined ? { operationId } : {}),
    ...(summary !== undefined ? { summary } : {}),
    params,
    requestMediaTypes,
    responseMediaTypes
  }
}

function parseResourceNode(raw: RawNode): WadlResource {
  const path = asString(raw[`${ATTR_PREFIX}path`]) ?? ''
  const params = toArray(raw['param'] as RawNode[] | RawNode | undefined).map(parseParamNode)
  const methods = toArray(raw['method'] as RawNode[] | RawNode | undefined).map(parseMethodNode)
  const children = toArray(raw['resource'] as RawNode[] | RawNode | undefined).map(parseResourceNode)
  return { path, params, methods, children }
}

function stripXsPrefix(type: string | undefined): string {
  if (!type) return 'string'
  return type.replace(/^xsd?:/i, '')
}

/** Flatten a `<complexType><sequence>...</sequence></complexType>` (or `all`
 * / `choice`) into a flat property list — one level deep, matching the
 * "skip deep XSD" scope: nested complex types are not resolved. */
function complexTypeToModel(name: string, complexType: RawNode): WadlGrammarModel {
  const group = (complexType['sequence'] ?? complexType['all'] ?? complexType['choice']) as RawNode | undefined
  const elements = toArray(group?.['element'] as RawNode[] | RawNode | undefined)
  const properties = elements
    .map((e) => ({
      name: asString(e[`${ATTR_PREFIX}name`]) ?? '',
      type: stripXsPrefix(asString(e[`${ATTR_PREFIX}type`])),
      required: e[`${ATTR_PREFIX}minOccurs`] !== '0'
    }))
    .filter((p) => p.name !== '')
  return { name, properties }
}

/** Walk `<grammars>` for trivial inline XSD models. External refs
 * (`<include href>` / `<import schemaLocation>`) are collected but never
 * fetched or resolved — surfaced as a documentation note instead. */
function extractGrammars(grammarsNode: unknown): { models: WadlGrammarModel[]; externalSchemaRefs: string[] } {
  const models: WadlGrammarModel[] = []
  const externalSchemaRefs: string[] = []
  for (const grammars of toArray(grammarsNode as RawNode[] | RawNode | undefined)) {
    for (const include of toArray(grammars['include'] as RawNode[] | RawNode | undefined)) {
      const href = asString(include[`${ATTR_PREFIX}href`])
      if (href !== undefined) externalSchemaRefs.push(href)
    }
    for (const schema of toArray(grammars['schema'] as RawNode[] | RawNode | undefined)) {
      for (const imp of toArray(schema['import'] as RawNode[] | RawNode | undefined)) {
        const location = asString(imp[`${ATTR_PREFIX}schemaLocation`])
        if (location !== undefined) externalSchemaRefs.push(location)
      }
      for (const element of toArray(schema['element'] as RawNode[] | RawNode | undefined)) {
        const name = asString(element[`${ATTR_PREFIX}name`])
        const complexType = element['complexType'] as RawNode | undefined
        if (name !== undefined && complexType !== undefined) models.push(complexTypeToModel(name, complexType))
      }
      for (const complexType of toArray(schema['complexType'] as RawNode[] | RawNode | undefined)) {
        const name = asString(complexType[`${ATTR_PREFIX}name`])
        if (name !== undefined) models.push(complexTypeToModel(name, complexType))
      }
    }
  }
  return { models, externalSchemaRefs }
}

function parseWadl(content: string): ParsedWadl {
  const verdict = XMLValidator.validate(content)
  if (verdict !== true) {
    throw new Error(`Invalid WADL XML: ${verdict.err.msg}`)
  }
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: ATTR_PREFIX,
    removeNSPrefix: true,
    isArray: (tag) => ARRAY_TAGS.has(tag)
  })
  const parsed = parser.parse(content) as RawNode
  const application = (parsed['application'] ?? parsed) as RawNode

  const resourcesBlocks = toArray(application['resources'] as RawNode[] | RawNode | undefined)
  const base = asString(resourcesBlocks[0]?.[`${ATTR_PREFIX}base`]) ?? ''
  const roots = resourcesBlocks.flatMap((block) =>
    toArray(block['resource'] as RawNode[] | RawNode | undefined).map(parseResourceNode)
  )

  const { models, externalSchemaRefs } = extractGrammars(application['grammars'])
  const title = docText(application['doc'])

  return { base, ...(title !== undefined ? { title } : {}), roots, models, externalSchemaRefs }
}

// ============================================================================
// Folder / request builders
// ============================================================================

function joinPath(base: string, segment: string): string {
  if (!segment) return base
  const left = base.endsWith('/') ? base.slice(0, -1) : base
  const right = segment.startsWith('/') ? segment : `/${segment}`
  return `${left}${right}`
}

/** Later entries win over earlier ones for the same `style:name` pair —
 * lets a method-level `<param>` override one declared on an ancestor
 * `<resource>`. */
function mergeParams(base: WadlParam[], overrides: WadlParam[]): WadlParam[] {
  const byKey = new Map<string, WadlParam>()
  for (const param of base) byKey.set(`${param.style}:${param.name}`, param)
  for (const param of overrides) byKey.set(`${param.style}:${param.name}`, param)
  return [...byKey.values()]
}

/** WADL and Restorm both use `{var}`-style path templates for a single
 * identifier segment, so every `{var}` occurring in a resource path is
 * unambiguously a template parameter — no "declared vs literal" ambiguity
 * to resolve, unlike OpenAPI's looser `{var}` reuse in free-form strings. */
function toHandlebars(path: string): string {
  return path.replace(/\{([A-Za-z_$][A-Za-z0-9_$.-]*)\}/g, '{{$1}}')
}

function buildRequest(method: WadlMethod, fullPath: string, scopedParams: WadlParam[]): HTTPRequest {
  const allParams = mergeParams(scopedParams, method.params)
  const templateParams = allParams.filter((p) => p.style === 'template')
  const queryParams = allParams.filter((p) => p.style === 'query')
  const headerParams = allParams.filter((p) => p.style === 'header')

  const headers = headerParams.map((p) => createTypedKeyValue({ key: p.name, value: p.defaultValue ?? '', enabled: true }))
  const params = queryParams.map((p) => createTypedKeyValue({ key: p.name, value: p.defaultValue ?? '', enabled: true }))
  const pathParams = templateParams.map((p) => createTypedKeyValue({ key: p.name, value: p.defaultValue ?? '', enabled: true }))

  const requestMediaType = method.requestMediaTypes[0]
  const responseMediaType = method.responseMediaTypes[0]
  if (requestMediaType !== undefined) {
    headers.push(createTypedKeyValue({ key: 'Content-Type', value: requestMediaType, enabled: true }))
  }
  if (responseMediaType !== undefined) {
    headers.push(createTypedKeyValue({ key: 'Accept', value: responseMediaType, enabled: true }))
  }

  const httpMethod = toHTTPMethod(method.verb)
  const bodyBearing = httpMethod === 'POST' || httpMethod === 'PUT' || httpMethod === 'PATCH'
  const body: HTTPRequestBody | undefined = bodyBearing && requestMediaType !== undefined
    ? { type: 'text', content: requestMediaType.includes('json') ? '{}' : '' }
    : undefined

  const naturalKey = `${httpMethod} ${fullPath}`
  const request = new HTTPRequest({
    id: generateId(`wadl:request:${naturalKey}`),
    name: method.operationId ?? naturalKey,
    documentation: method.summary ?? '',
    tags: ['wadl'],
    method: httpMethod,
    url: `{{baseUrl}}${toHandlebars(fullPath)}`,
    headers,
    params,
    pathParams,
    importOrigin: {
      format: 'wadl',
      naturalKey,
      ...(method.operationId !== undefined ? { operationId: method.operationId } : {})
    }
  })
  if (body !== undefined) request.body = body
  return request
}

/** Recursively turn a `<resource>` (and its descendants) into a `Folder`.
 * One resource == one folder, regardless of how many path segments its own
 * `path` attribute spans — mirrors the ticket's stated mapping. */
function buildFolder(resource: WadlResource, basePath: string, inheritedParams: WadlParam[]): Folder {
  const fullPath = joinPath(basePath, resource.path)
  const scopedParams = mergeParams(inheritedParams, resource.params)

  const items: Folder['items'] = [
    ...resource.methods.map((method) => buildRequest(method, fullPath, scopedParams)),
    ...resource.children.map((child) => buildFolder(child, fullPath, scopedParams))
  ]

  const name = resource.path.replace(/^\/+|\/+$/g, '') || fullPath.replace(/^\/+|\/+$/g, '') || 'resource'
  return {
    id: generateId(`wadl:folder:${fullPath}`),
    name,
    tags: [],
    configuration: {},
    items
  }
}

// ============================================================================
// ApiDocumentation transformer
// ============================================================================

function collectOperations(
  resource: WadlResource,
  basePath: string,
  inheritedParams: WadlParam[],
  out: OperationDocumentation[]
): void {
  const fullPath = joinPath(basePath, resource.path)
  const scopedParams = mergeParams(inheritedParams, resource.params)

  for (const method of resource.methods) {
    const allParams = mergeParams(scopedParams, method.params)
    const doc: OperationDocumentation = {
      match: {
        urlPattern: fullPath,
        method: method.verb
      }
    }
    if (method.summary !== undefined) doc.summary = method.summary
    if (method.operationId !== undefined) doc.operationId = method.operationId
    if (method.requestMediaTypes.length > 0) doc.consumes = method.requestMediaTypes
    if (method.responseMediaTypes.length > 0) doc.produces = method.responseMediaTypes
    if (allParams.length > 0) {
      doc.parameters = allParams.map((p) => ({
        name: p.name,
        location: p.style,
        type: stripXsPrefix(p.type),
        required: p.required,
        ...(p.defaultValue !== undefined ? { defaultValue: p.defaultValue } : {})
      }))
    }
    out.push(doc)
  }
  for (const child of resource.children) collectOperations(child, fullPath, scopedParams, out)
}

function buildApiDocumentation(
  parsed: ParsedWadl,
  options: { baseUrl?: string; sourceUrl?: string; apiTitle: string }
): ApiDocumentation {
  const models: Record<string, ModelDocumentation> = {}
  for (const model of parsed.models) {
    models[model.name] = {
      name: model.name,
      properties: model.properties.map((p) => ({ name: p.name, type: p.type, required: p.required }))
    }
  }

  const operations: OperationDocumentation[] = []
  for (const root of parsed.roots) collectOperations(root, '', [], operations)

  const description = parsed.externalSchemaRefs.length > 0
    ? `WADL service. External XSD schema(s) referenced but not resolved: ${parsed.externalSchemaRefs.join(', ')}.`
    : 'WADL service.'

  const doc: ApiDocumentation = {
    sourceType: 'wadl',
    api: { title: options.apiTitle, description },
    models,
    groups: {},
    operations
  }
  if (options.sourceUrl !== undefined) doc.sourceUrl = options.sourceUrl
  if (options.baseUrl !== undefined) doc.server = { host: options.baseUrl }
  return doc
}

// ============================================================================
// Public entry points
// ============================================================================

export interface WadlImportOptions {
  /** Override for the generated environment baseUrl. Defaults to the WADL's
   * own `<resources base="...">`. */
  baseUrl?: string
  /** Name for the imported collection. */
  name?: string
  /** Original URL the WADL was fetched from (stored on ApiDocumentation.sourceUrl). */
  sourceUrl?: string
}

/** Import a WADL document and convert it to an `EnvironmentFolder`. */
export function importWadl(content: string, options: WadlImportOptions = {}): EnvironmentFolder {
  const parsed = parseWadl(content)
  const name = options.name ?? parsed.title ?? 'WADL API'
  const baseUrl = options.baseUrl ?? nonEmpty(parsed.base) ?? 'http://localhost:8080'

  const environment: Environment = {
    id: generateId(`wadl:env:${name}:Default`),
    name: 'Default',
    variables: [createTypedKeyValue({ key: 'baseUrl', value: baseUrl, enabled: true })]
  }

  const items: Folder['items'] = parsed.roots.map((root) => buildFolder(root, '', []))

  const apiDocumentation = buildApiDocumentation(parsed, {
    baseUrl,
    ...(options.sourceUrl !== undefined ? { sourceUrl: options.sourceUrl } : {}),
    apiTitle: name
  })

  return {
    folderType: 'environment',
    fileFormatVersion: CURRENT_FILE_FORMAT_VERSION,
    importSource: 'wadl',
    id: generateId(`wadl:folder:root:${name}`),
    name,
    tags: ['wadl'],
    tagColors: {},
    configuration: {},
    environments: [environment],
    items,
    apiDocumentation
  }
}

/** Import a WADL document from a plain string — mirrors the other
 * `import<Format>FromString` entry points. */
export function importWadlFromString(content: string, options: WadlImportOptions = {}): EnvironmentFolder {
  return importWadl(content, options)
}

// ============================================================================
// Provider registration
// ============================================================================

import { importProviders } from './registry'

const WADL_NAMESPACE = 'wadl.dev.java.net'

function canImport(content: string, filePath?: string): boolean {
  if (filePath?.endsWith('.wadl')) return true
  return content.includes(WADL_NAMESPACE)
}

importProviders.push({ format: 'wadl', canImport, parse: (content, opts) => importWadl(content, opts) })
