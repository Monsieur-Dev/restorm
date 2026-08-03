/**
 * Service for importing API Blueprint (`.apib`) specifications into Restorm
 * collections.
 *
 * API Blueprint is parsed via `drafter.js` — a pure-WASM (Emscripten) build
 * of the reference Drafter C++ parser, chosen over the native `protagonist`
 * addon (also shipped inside the `drafter` npm package) specifically because
 * it needs no `node-gyp` rebuild step: the WASM binary loads identically
 * under plain Node and under Electron's bundled V8, so there's nothing to
 * recompile against Electron's ABI when the app is packaged. `parseSync`
 * gives a synchronous parse, matching the `ImportProvider.parse` contract.
 *
 * The parser hands back an API Elements (refract) tree, not the simplified
 * JSON shape some drafter versions expose via a `type: 'ast'` option — every
 * node, including primitives, is wrapped as `{ element, meta?, attributes?,
 * content }`. `apiBlueprintToApiDocumentation` documents that shape and owns
 * the refract-reading helpers; this file walks the same tree to build the
 * imported folder + requests.
 */

import {
  Folder,
  EnvironmentFolder,
  Environment,
  HTTPRequest,
  KeyValue,
  type HTTPRequestBody
} from '../../../shared/models'
import { StringValue, NumericValue, type ValueType } from '../../../shared/types/collections'
import { toHTTPMethod } from './httpMethodValidator'
import { stableImportId as generateId } from './stableImportId'
import {
  apiBlueprintToApiDocumentation,
  arrayContent,
  collectAssetText,
  contentArray,
  hasClass,
  memberKeyValue,
  metadataValue,
  stringContent,
  titleOf,
  type RefractElement
} from './transformers/apiBlueprintToApiDocumentation'
import drafter from 'drafter.js'

// ============================================================================
// URI Template handling
// ============================================================================

/** Names listed in a `{?a,b}` query-expansion group, if the href has one. */
function extractQueryVarNames(href: string): string[] {
  const match = /\{\?([^}]+)\}/.exec(href)
  if (match?.[1] === undefined) return []
  return match[1].split(',').map((s) => s.trim()).filter((s) => s.length > 0)
}

/** Bare `{name}` path-variable tokens, excluding the `{?...}` query group. */
function extractPathVarNames(href: string): string[] {
  const withoutQuery = href.replace(/\{\?[^}]+\}/, '')
  return [...withoutQuery.matchAll(/\{([^}?/]+)\}/g)].map((m) => m[1]).filter((n): n is string => n !== undefined)
}

/** Build the request URL: strip the query-expansion group (surfaced as `params` instead)
 * and rewrite `{name}` path tokens to Restorm's `{{name}}` Handlebars placeholder. */
function buildUrl(href: string): string {
  let url = href.replace(/\{\?[^}]+\}/, '')
  for (const name of extractPathVarNames(href)) {
    url = url.replace(`{${name}}`, `{{${name}}}`)
  }
  return `{{baseUrl}}${url}`
}

/** Build a KeyValue with a stable, content-derived id — same rationale as
 * `SwaggerImportService.kvOfType`: re-importing the same document must
 * produce the same ids so the idempotent pipeline can match items instead
 * of duplicating them. */
function kvOfType(key: string, value: ValueType): KeyValue {
  return new KeyValue({ id: generateId(`kv:${key}:${String(value)}`), key, value })
}

function buildTypedValueFromApiBlueprintType(typeName: string | undefined, defaultValue?: string): ValueType {
  if (typeName === 'number') {
    const num = defaultValue !== undefined ? Number(defaultValue) : 0
    return new NumericValue(Number.isFinite(num) ? num : 0, 'decimal')
  }
  if (typeName === 'boolean') {
    return new StringValue(defaultValue ?? 'false')
  }
  return new StringValue(defaultValue ?? '')
}

/** Build path + query KeyValues from the resource's `+ Parameters` (hrefVariables)
 * section, falling back to bare URI-template token names when the resource
 * declares no typed parameters. */
function extractHrefParams(resource: RefractElement): { pathParams: KeyValue[]; params: KeyValue[] } {
  const href = stringContent(resource.attributes?.href) ?? '/'
  const queryVarNames = new Set(extractQueryVarNames(href))
  const hrefVariables = arrayContent(resource.attributes?.hrefVariables)

  if (hrefVariables.length === 0) {
    const pathParams = extractPathVarNames(href).map((name) => kvOfType(name, new StringValue('')))
    const params = [...queryVarNames].map((name) => kvOfType(name, new StringValue('')))
    return { pathParams, params }
  }

  const pathParams: KeyValue[] = []
  const params: KeyValue[] = []
  for (const member of hrefVariables) {
    const { key, value } = memberKeyValue(member)
    if (!key) continue
    const typedValue = buildTypedValueFromApiBlueprintType(titleOf(member) ?? value?.element, stringContent(value))
    const kv = kvOfType(key, typedValue)
    if (queryVarNames.has(key)) params.push(kv)
    else pathParams.push(kv)
  }
  return { pathParams, params }
}

// ============================================================================
// Resource / transition → HTTPRequest
// ============================================================================

function extractHeaders(httpMessage: RefractElement): KeyValue[] {
  const members = arrayContent(httpMessage.attributes?.headers)
  return members.map((member) => {
    const { key, value } = memberKeyValue(member)
    return kvOfType(key ?? '', new StringValue(stringContent(value) ?? ''))
  })
}

function extractBody(httpRequest: RefractElement): HTTPRequestBody | undefined {
  const content = collectAssetText(httpRequest, 'messageBody')
  return content !== undefined ? { type: 'text', content } : undefined
}

/** Build an HTTPRequest from one `httpTransaction` (request/response pair) inside a transition.
 * Documentation is intentionally left empty — it's compiled on demand from the root
 * folder's `apiDocumentation`, same as the Swagger / AsyncAPI importers. */
function httpTransactionToRequest(
  resource: RefractElement,
  transitionTitle: string | undefined,
  httpTransaction: RefractElement,
  index: number
): HTTPRequest | undefined {
  const [request] = contentArray(httpTransaction)
  if (request?.element !== 'httpRequest') return undefined

  const href = stringContent(resource.attributes?.href) ?? '/'
  const method = toHTTPMethod(stringContent(request.attributes?.method))
  const { pathParams, params } = extractHrefParams(resource)
  // Anchor for the idempotent refresh pipeline — see `SwaggerImportService.operationToRequest`
  // for the matching rationale. `#<index>` disambiguates the rare case of a transition
  // documenting more than one request/response example pair.
  const naturalKey = `${method} ${href}${index > 0 ? `#${index}` : ''}`

  const httpRequest: HTTPRequest = {
    type: 'http',
    id: generateId(`request:${naturalKey}`),
    name: transitionTitle ?? `${method} ${href}`,
    tags: [],
    method,
    url: buildUrl(href),
    headers: extractHeaders(request),
    params,
    pathParams,
    importOrigin: { format: 'api-blueprint', naturalKey }
  }

  const body = extractBody(request)
  if (body) httpRequest.body = body

  return httpRequest
}

function resourceToRequests(resource: RefractElement): HTTPRequest[] {
  const requests: HTTPRequest[] = []
  for (const transition of contentArray(resource)) {
    if (transition.element !== 'transition') continue
    const transitionTitle = titleOf(transition)
    const httpTransactions = contentArray(transition).filter((el) => el.element === 'httpTransaction')
    httpTransactions.forEach((httpTransaction, index) => {
      const request = httpTransactionToRequest(resource, transitionTitle, httpTransaction, index)
      if (request) requests.push(request)
    })
  }
  return requests
}

// ============================================================================
// Main Service
// ============================================================================

export interface ApiBlueprintImportOptions {
  /** Override base URL (defaults to the spec's `HOST` metadata, then localhost). */
  baseUrl?: string
  /** Original URL the API Blueprint document was fetched from. */
  sourceUrl?: string
}

/** Import an already-parsed API Elements tree (the `# <Api Name>` root category). */
function importApiCategory(apiCategory: RefractElement, options: ApiBlueprintImportOptions): EnvironmentFolder {
  const name = titleOf(apiCategory) ?? 'API Blueprint'
  const host = metadataValue(apiCategory, 'HOST')

  const items: Folder['items'] = []
  const otherRequests: HTTPRequest[] = []

  for (const child of contentArray(apiCategory)) {
    if (child.element === 'category' && hasClass(child, 'resourceGroup')) {
      const groupLabel = titleOf(child) ?? 'Resource Group'
      const groupRequests = contentArray(child)
        .filter((el) => el.element === 'resource')
        .flatMap(resourceToRequests)
      if (groupRequests.length > 0) {
        items.push({
          id: generateId(`folder:group:${groupLabel}`),
          name: groupLabel,
          tags: [],
          configuration: {},
          items: groupRequests
        })
      }
    } else if (child.element === 'resource') {
      // Ungrouped resource declared directly under the API category.
      otherRequests.push(...resourceToRequests(child))
    }
  }

  if (otherRequests.length > 0) {
    items.push({
      id: generateId('folder:group:Other'),
      name: 'Other',
      tags: [],
      configuration: {},
      items: otherRequests
    })
  }

  const baseUrl = options.baseUrl ?? host ?? 'localhost:3000'
  const environment: Environment = {
    id: generateId(`${name}:env:api-blueprint:Default`),
    name: 'Default',
    variables: [kvOfType('baseUrl', new StringValue(baseUrl))]
  }

  const apiDocumentation = apiBlueprintToApiDocumentation(
    apiCategory,
    options.sourceUrl !== undefined ? { sourceUrl: options.sourceUrl } : {}
  )

  const rootFolder: EnvironmentFolder = {
    folderType: 'environment',
    importSource: 'api-blueprint',
    id: generateId(`folder:root:api-blueprint:${name}`),
    name,
    tags: [],
    configuration: {},
    environments: [environment],
    items,
    apiDocumentation
  }

  return rootFolder
}

/** Import an API Blueprint document from its raw `.apib` text. */
export function importApiBlueprint(content: string, options: ApiBlueprintImportOptions = {}): EnvironmentFolder {
  const parseResult = drafter.parseSync(content, {}) as RefractElement
  const apiCategory = contentArray(parseResult).find((el) => el.element === 'category' && hasClass(el, 'api'))
  if (!apiCategory) {
    throw new Error('Invalid API Blueprint document: no top-level API category found')
  }
  return importApiCategory(apiCategory, options)
}

// ============================================================================
// Provider registration
// ============================================================================

import { importProviders } from './registry'

function canImport(content: string, filePath?: string): boolean {
  const trimmed = content.trim()
  if (trimmed.startsWith('FORMAT: 1A')) return true
  return filePath?.toLowerCase().endsWith('.apib') ?? false
}

importProviders.push({
  format: 'api-blueprint',
  canImport,
  parse: (content, opts) => importApiBlueprint(content, opts)
})
