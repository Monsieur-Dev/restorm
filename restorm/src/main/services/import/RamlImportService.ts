/**
 * Service for importing RAML 1.0 (best-effort 0.8) specifications into
 * Restorm collections. RAML is YAML with a mandatory `#%RAML 1.0` (or
 * `#%RAML 0.8`) leading comment, so `canImport` sniffs that header
 * directly rather than trying (and failing) a YAML/JSON parse.
 *
 * Parsing is delegated to `raml-1-parser` — the reference JS/TS
 * implementation. The package itself carries an upstream deprecation
 * notice pointing at `webapi-parser` as its successor, but
 * `webapi-parser`'s API is promise-only while `ImportProvider.parse`
 * must run synchronously — `raml-1-parser` remains the only
 * dependency-free package with a synchronous RAML 1.0 AST entry point
 * (`loadApiSync`). `loadApiSync` only accepts a file path, not raw
 * content, so `parse` writes the source to a throwaway temp file
 * before handing it to the parser and always cleans up afterwards,
 * success or failure.
 *
 * Structured documentation is built by `ramlToApiDocumentation`
 * (mirrors the OpenAPI/Swagger transformers, reusing the same
 * `_shared.ts` helpers) and stored on the root `EnvironmentFolder`;
 * the renderer's `DocumentationHost` consumes that tree directly.
 */

import { writeFileSync, unlinkSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve as resolvePath } from 'node:path'
import * as raml from 'raml-1-parser'
import {
  Folder,
  EnvironmentFolder,
  Environment,
  HTTPRequest,
  KeyValue,
  type HTTPRequestBody
} from '../../../shared/models'
import { StringValue, NumericValue, ExpressionValue, type ValueType } from '../../../shared/types/collections'
import { toHTTPMethod } from './httpMethodValidator'
import {
  ramlTypeToCommonSchema,
  type RamlApi,
  type RamlMethodNode,
  type RamlResourceNode,
  type RamlSecuritySchemeNode,
  type RamlTypeNode
} from './transformers/ramlToApiDocumentation'
import { ramlToApiDocumentation } from './transformers/ramlToApiDocumentation'
import type { CommonSchema } from './transformers/_shared'
import { rewriteUrlTemplate } from './transformers/_shared'
import { CURRENT_FILE_FORMAT_VERSION } from '../../../shared/config/fileFormatVersion'
import { stableImportId as generateId } from './stableImportId'

// ────────────────────────────────────────────────────────────────────────────
// KeyValue / typed-value helpers
// ────────────────────────────────────────────────────────────────────────────

function kvOfType(key: string, value: ValueType, description?: string): KeyValue {
  return new KeyValue({
    id: generateId(`kv:${key}:${String(value)}`),
    key,
    value,
    description: description ?? '',
    enabled: true
  })
}

/** Map a normalised `CommonSchema` (already produced by `ramlTypeToCommonSchema`)
 * to a typed Restorm `ValueType` for a header / query / path param input. */
function buildTypedValue(schema: CommonSchema): ValueType {
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type
  const preset = schema.enum?.find((v): v is string => typeof v === 'string')
  const initial = typeof schema.default === 'string' ? schema.default : preset
  switch (type) {
    case 'integer':
    case 'number': {
      const num = typeof schema.default === 'number' ? schema.default : 0
      return new NumericValue(num, 'decimal')
    }
    case 'boolean':
      return new StringValue(schema.default === true ? 'true' : schema.default === false ? 'false' : 'false')
    default:
      return new StringValue(initial ?? '')
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Sample body generation — walks a `CommonSchema`, resolving named-type
// `$ref`s against the map built from `api.types()`.
// ────────────────────────────────────────────────────────────────────────────

function schemaToSample(schema: CommonSchema, typesByName: Map<string, CommonSchema>, depth = 0, seenRefs = new Set<string>()): unknown {
  if (depth > 5) return null
  if (schema.$ref) {
    const refName = schema.$ref.split('/').pop() ?? ''
    if (seenRefs.has(refName)) return null
    const resolved = typesByName.get(refName)
    if (!resolved) return null
    return schemaToSample(resolved, typesByName, depth + 1, new Set(seenRefs).add(refName))
  }
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type
  switch (type) {
    case 'object': {
      const result: Record<string, unknown> = {}
      for (const [propName, propSchema] of Object.entries(schema.properties ?? {})) {
        result[propName] = schemaToSample(propSchema, typesByName, depth + 1, seenRefs)
      }
      return result
    }
    case 'array':
      return schema.items ? [schemaToSample(schema.items, typesByName, depth + 1, seenRefs)] : []
    case 'integer':
    case 'number':
      return 0
    case 'boolean':
      return false
    default:
      if (schema.enum && schema.enum.length > 0) return schema.enum[0]
      return ''
  }
}

// ────────────────────────────────────────────────────────────────────────────
// URL + path params
// ────────────────────────────────────────────────────────────────────────────

/** Extract `{name}` placeholders from a URL template, in order of appearance. */
function extractPathParamNames(template: string): string[] {
  const names: string[] = []
  const re = /\{([A-Za-z_$][A-Za-z0-9_$.-]*)\}/g
  let match: RegExpExecArray | null
  while ((match = re.exec(template)) !== null) {
    const name = match[1]
    if (name !== undefined && !names.includes(name)) names.push(name)
  }
  return names
}

// ────────────────────────────────────────────────────────────────────────────
// Security pre-wiring — Basic + OAuth2 map to an `Authorization` header;
// every other scheme (Digest, Pass Through, OAuth 1.0, custom `x-*`) stays
// documentation-only, matching the ticket's known-limitations note.
// ────────────────────────────────────────────────────────────────────────────

function applyRamlSecurityToRequest(
  request: HTTPRequest,
  securedBy: { securitySchemeName(): string }[],
  schemesByName: Map<string, RamlSecuritySchemeNode>
): void {
  for (const ref of securedBy) {
    const scheme = schemesByName.get(ref.securitySchemeName())
    if (!scheme) continue
    if (request.headers.some((kv) => kv.key.toLowerCase() === 'authorization')) continue
    if (scheme.type() === 'Basic Authentication') {
      request.headers.push({ key: 'Authorization', value: new ExpressionValue(`Basic {{${scheme.name()}_credentials}}`) })
    } else if (scheme.type() === 'OAuth 2.0') {
      request.headers.push({ key: 'Authorization', value: new ExpressionValue(`Bearer {{${scheme.name()}_token}}`) })
    }
  }
}

/** Variable names implied by the pre-wired Authorization placeholders
 * above, so the user gets an explicit env-folder row to fill in. */
function collectSecurityVariableNames(schemes: RamlSecuritySchemeNode[]): string[] {
  const out: string[] = []
  for (const scheme of schemes) {
    if (scheme.type() === 'Basic Authentication') out.push(`${scheme.name()}_credentials`)
    else if (scheme.type() === 'OAuth 2.0') out.push(`${scheme.name()}_token`)
  }
  return out
}

// ────────────────────────────────────────────────────────────────────────────
// Method → HTTPRequest
// ────────────────────────────────────────────────────────────────────────────

function methodToRequest(
  resource: RamlResourceNode,
  method: RamlMethodNode,
  urlTemplate: string,
  typesByName: Map<string, CommonSchema>,
  schemesByName: Map<string, RamlSecuritySchemeNode>,
  rootSecuredBy: { securitySchemeName(): string }[]
): HTTPRequest {
  const verb = method.method()
  const declaredPathParams = extractPathParamNames(urlTemplate)
  const uriParamNodes = typeof resource.uriParameters === 'function' ? resource.uriParameters() : []
  const uriParamsByName = new Map(uriParamNodes.map((p) => [p.name(), p]))

  const headers = method.headers().map((h) => kvOfType(h.name(), buildTypedValue(ramlTypeToCommonSchema(h)), describe(h)))
  const params = method.queryParameters().map((p) => kvOfType(p.name(), buildTypedValue(ramlTypeToCommonSchema(p)), describe(p)))
  const pathParams = declaredPathParams.map((name) => {
    const declared = uriParamsByName.get(name)
    return kvOfType(name, declared ? buildTypedValue(ramlTypeToCommonSchema(declared)) : new StringValue(''), declared ? describe(declared) : undefined)
  })

  const request: HTTPRequest = {
    type: 'http',
    id: generateId(`request:${verb}:${urlTemplate}`),
    name: (typeof method.displayName === 'function' && method.displayName()) || `${verb.toUpperCase()} ${urlTemplate}`,
    tags: [],
    method: toHTTPMethod(verb),
    url: `{{baseUrl}}${rewriteUrlTemplate(urlTemplate)}`,
    headers,
    params,
    pathParams,
    importOrigin: { format: 'raml', naturalKey: `${verb.toUpperCase()} ${urlTemplate}` }
  }

  const requestBody = method.body()[0]
  if (requestBody !== undefined) {
    const bodySchema = ramlTypeToCommonSchema(requestBody)
    const sample = schemaToSample(bodySchema, typesByName)
    const body: HTTPRequestBody = { type: 'text', content: JSON.stringify(sample ?? {}, null, 2) }
    request.body = body
  }

  const securedBy = typeof method.securedBy === 'function' && method.securedBy().length > 0
    ? method.securedBy()
    : typeof resource.securedBy === 'function' && resource.securedBy().length > 0
      ? resource.securedBy()
      : rootSecuredBy
  applyRamlSecurityToRequest(request, securedBy, schemesByName)

  return request
}

function describe(node: RamlTypeNode): string | undefined {
  const description = typeof node.description === 'function' ? node.description() : null
  return description != null ? description.value() : undefined
}

// ────────────────────────────────────────────────────────────────────────────
// Resource tree → Folder tree
// ────────────────────────────────────────────────────────────────────────────

function resourceToFolder(
  resource: RamlResourceNode,
  typesByName: Map<string, CommonSchema>,
  schemesByName: Map<string, RamlSecuritySchemeNode>,
  rootSecuredBy: { securitySchemeName(): string }[]
): Folder {
  const urlTemplate = resource.completeRelativeUri()
  const name = (typeof resource.displayName === 'function' && resource.displayName()) || resource.relativeUri().value()
  const folder: Folder = {
    id: generateId(`folder:${urlTemplate}`),
    name,
    tags: [],
    configuration: {},
    items: []
  }
  for (const method of resource.methods()) {
    folder.items.push(methodToRequest(resource, method, urlTemplate, typesByName, schemesByName, rootSecuredBy))
  }
  for (const child of resource.resources()) {
    folder.items.push(resourceToFolder(child, typesByName, schemesByName, rootSecuredBy))
  }
  return folder
}

// ────────────────────────────────────────────────────────────────────────────
// Root environment — `baseUri` + one variable per `{placeholder}` token
// ────────────────────────────────────────────────────────────────────────────

function extractDomainName(urlOrTemplate: string): string {
  try {
    const url = new URL(urlOrTemplate.replace(/\{[^}]+\}/g, 'placeholder'))
    return url.hostname
  } catch {
    return 'Default'
  }
}

function createRamlEnvironment(api: RamlApi, schemes: RamlSecuritySchemeNode[]): Environment {
  const rawBaseUri = api.baseUri().value()
  const version = typeof api.version === 'function' ? api.version() : null
  const variables: KeyValue[] = []
  for (const name of extractPathParamNames(rawBaseUri)) {
    const initial = name === 'version' && version != null ? version : ''
    variables.push(kvOfType(name, new StringValue(initial)))
  }
  variables.push(kvOfType('baseUrl', new ExpressionValue(rewriteUrlTemplate(rawBaseUri))))

  for (const varName of collectSecurityVariableNames(schemes)) {
    if (variables.some((kv) => kv.key === varName)) continue
    variables.push(kvOfType(varName, new StringValue('')))
  }

  return {
    id: generateId(`env:root:${extractDomainName(rawBaseUri)}`),
    name: extractDomainName(rawBaseUri),
    variables,
    subEnvironments: []
  }
}

// ────────────────────────────────────────────────────────────────────────────
// `!include` lockdown — deny filesystem escapes and every HTTP(S) fetch
// ────────────────────────────────────────────────────────────────────────────

interface RamlFsResolver {
  content(path: string): string
  contentAsync(path: string): Promise<string>
}

interface RamlHttpResolver {
  getResource(url: string): { content?: string; errorMessage?: string }
  getResourceAsync(url: string): Promise<{ content?: string; errorMessage?: string }>
}

/**
 * `raml-1-parser`'s default resolvers happily follow a RAML document's
 * `!include` directives against the real filesystem AND arbitrary URLs. An
 * imported RAML document is attacker-controlled content, so left on
 * defaults it could smuggle `!include "/etc/passwd"` (arbitrary local file
 * read) or `!include "http://169.254.169.254/..."` (SSRF against loopback /
 * cloud metadata / RFC1918) and have the result INLINED into the parsed
 * model — surfacing in the imported requests, types, or examples.
 *
 * Locks both channels down: filesystem access is pinned to the exact temp
 * file this importer wrote for `content` (no legitimate include can resolve
 * anywhere else — the temp file has no sibling files, so relative includes
 * were already broken before this lockdown; denying them loses nothing).
 * Every HTTP(S) fetch is refused outright — an importer must never make an
 * out-of-band network call on the parsed document's behalf.
 */
function createLockedDownResolvers(allowedPath: string): { fsResolver: RamlFsResolver; httpResolver: RamlHttpResolver } {
  const resolvedAllowedPath = resolvePath(allowedPath)
  const denyFs = (path: string): never => {
    throw new Error(`RAML import: refusing to resolve "!include ${path}" — external file includes are not supported`)
  }
  const readContained = (path: string): string => (resolvePath(path) === resolvedAllowedPath ? readFileSync(allowedPath, 'utf-8') : denyFs(path))
  const fsResolver: RamlFsResolver = {
    content: readContained,
    contentAsync: (path) => Promise.resolve(readContained(path))
  }
  const denyHttp = (url: string): { errorMessage: string } => ({
    errorMessage: `RAML import: refusing to resolve "!include ${url}" — external URL includes are not supported`
  })
  const httpResolver: RamlHttpResolver = {
    getResource: denyHttp,
    getResourceAsync: (url) => Promise.resolve(denyHttp(url))
  }
  return { fsResolver, httpResolver }
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

export interface RamlImportOptions {
  /** Original URL the spec was fetched from (stored on `ApiDocumentation.sourceUrl`). */
  sourceUrl?: string
}

/** Parse a RAML 1.0 / 0.8 document into a Folder structure.
 *
 * `raml-1-parser`'s synchronous entry points only accept a file path, so
 * the content is written to a throwaway temp file first; the temp file is
 * always removed, even if parsing throws. `!include` resolution is locked
 * down (see `createLockedDownResolvers`) so a hostile document can't read
 * arbitrary local files or make the import fetch an arbitrary URL. */
export function importRaml(content: string, options: RamlImportOptions = {}): EnvironmentFolder {
  const tempFile = join(tmpdir(), `restorm-import-${Date.now()}-${Math.random().toString(36).slice(2)}.raml`)
  writeFileSync(tempFile, content, 'utf-8')
  let api: RamlApi
  try {
    api = raml.loadApiSync(tempFile, createLockedDownResolvers(tempFile)) as unknown as RamlApi
  } finally {
    try { unlinkSync(tempFile) } catch { /* best-effort cleanup */ }
  }

  // Inline traits + resourceTypes so every method's real headers /
  // query params / responses are visible on the expanded resource tree.
  const expanded = api.expand()

  const schemeNodes = typeof expanded.securitySchemes === 'function' ? expanded.securitySchemes() : []
  const schemesByName = new Map(schemeNodes.map((s) => [s.name(), s]))
  const rootSecuredBy = typeof expanded.securedBy === 'function' ? expanded.securedBy() : []

  const typeNodes = typeof expanded.types === 'function' ? expanded.types() : []
  const typesByName = new Map(typeNodes.map((t) => [t.name(), ramlTypeToCommonSchema(t)]))

  const environment = createRamlEnvironment(expanded, schemeNodes)
  const items = expanded.resources().map((resource) => resourceToFolder(resource, typesByName, schemesByName, rootSecuredBy))
  const apiDocumentation = ramlToApiDocumentation(expanded, options.sourceUrl !== undefined ? { sourceUrl: options.sourceUrl } : {})

  const rootFolder: EnvironmentFolder = {
    folderType: 'environment',
    fileFormatVersion: CURRENT_FILE_FORMAT_VERSION,
    id: generateId(`folder:root:${expanded.title()}`),
    name: expanded.title(),
    tags: [],
    configuration: {},
    environments: [environment],
    items,
    importSource: 'raml',
    apiDocumentation
  }
  return rootFolder
}

// ============================================================================
// Provider registration
// ============================================================================

import { importProviders } from './registry'

function canImportRaml(content: string, filePath?: string): boolean {
  if (filePath?.endsWith('.raml')) return true
  const trimmed = content.trimStart()
  return trimmed.startsWith('#%RAML 1.0') || trimmed.startsWith('#%RAML 0.8')
}

importProviders.push({ format: 'raml', canImport: canImportRaml, parse: (content, opts) => importRaml(content, opts) })
