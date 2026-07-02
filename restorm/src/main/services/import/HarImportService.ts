/**
 * Service for importing HAR (HTTP Archive) files into Restorm collections
 *
 * HAR is the network-capture export format shared by every major browser's
 * devtools (Chrome, Firefox, Safari, Edge). Each `log.entries[]` item is one
 * network call the browser observed — this importer turns every entry into
 * a replayable HTTP request, faithfully carrying over:
 * - method, URL, query params
 * - headers (HTTP/2 pseudo-headers and the stale `content-length` are
 *   dropped — see `parseHeaders`)
 * - cookies (HAR lists them separately; Restorm merges them into a single
 *   `Cookie` header, same as the wire format)
 * - request bodies: JSON / raw text, `x-www-form-urlencoded`, multipart
 *   `form-data`
 *
 * Entries are grouped into a folder per HAR page (`entry.pageref`, named
 * after the matching `log.pages[].title`); archives with a single page (or
 * no page information at all — some HAR producers omit `pages`) import flat
 * under the root folder instead of adding a redundant single sub-folder.
 *
 * v1 deliberately imports every entry as-is, including repeated calls to
 * the same method + URL (e.g. a polling endpoint) — deduping into one
 * request with multiple history entries is a nice-to-have left for later.
 */

import {
  EnvironmentFolder,
  Folder,
  HTTPRequest,
  type HTTPRequestBody,
  type KeyValue
} from '../../../shared/models'
import { toHTTPMethod } from './httpMethodValidator'
import { createTypedKeyValue } from '../../../shared/utils/createTypedKeyValue'
import { CURRENT_FILE_FORMAT_VERSION } from '../../../shared/config/fileFormatVersion'
import { stableImportId as generateId } from './stableImportId'
import type { HTTPExecutionResult } from '../HTTPExecutionService'

// ============================================================================
// HAR 1.2 types (subset actually consumed)
// ============================================================================

interface HarNameValuePair {
  name: string
  value: string
}

interface HarPostDataParam {
  name: string
  value?: string
  fileName?: string
  contentType?: string
}

interface HarPostData {
  mimeType?: string
  text?: string
  params?: HarPostDataParam[]
}

interface HarRequest {
  method: string
  url: string
  httpVersion?: string
  cookies?: HarNameValuePair[]
  headers?: HarNameValuePair[]
  queryString?: HarNameValuePair[]
  postData?: HarPostData
}

interface HarContent {
  size?: number
  mimeType?: string
  text?: string
  encoding?: string
}

interface HarResponse {
  status: number
  statusText?: string
  httpVersion?: string
  cookies?: HarNameValuePair[]
  headers?: HarNameValuePair[]
  content?: HarContent
  redirectURL?: string
}

interface HarEntry {
  startedDateTime?: string
  time?: number
  request: HarRequest
  response?: HarResponse
  pageref?: string
}

interface HarPage {
  id: string
  title?: string
}

interface HarLog {
  version?: string
  entries: HarEntry[]
  pages?: HarPage[]
}

export interface HarFile {
  log: HarLog
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Header names that must never be replayed verbatim: HTTP/2 pseudo-headers
 * (`:authority`, `:method`, …) aren't real wire headers, and a captured
 * `content-length` goes stale the moment the body is edited — Restorm
 * computes it at send time. Everything else (including `host` / `cookie`,
 * handled separately below) is kept so the request is a faithful capture. */
function isDroppedHeaderName(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.startsWith(':') || lower === 'content-length'
}

/** Merge HAR headers + the separate `cookies[]` array into one KeyValue
 * list. HAR keeps cookies structured on top of an often-already-present
 * literal `Cookie` header; when `cookies[]` carries entries we rebuild a
 * single canonical `Cookie` header from it (avoiding a duplicate), and
 * otherwise leave any already-present `Cookie` header untouched. */
function parseHeaders(request: HarRequest): KeyValue[] {
  const hasCookies = (request.cookies ?? []).length > 0
  const headers = (request.headers ?? [])
    .filter((h) => !isDroppedHeaderName(h.name))
    .filter((h) => !(hasCookies && h.name.toLowerCase() === 'cookie'))
    .map((h) => createTypedKeyValue({ key: h.name, value: h.value, enabled: true }))

  if (hasCookies) {
    const cookieValue = (request.cookies ?? []).map((c) => `${c.name}=${c.value}`).join('; ')
    headers.push(createTypedKeyValue({ key: 'Cookie', value: cookieValue, enabled: true }))
  }

  return headers
}

/** `entry.request.queryString[]` → Restorm query params. The raw URL is
 * imported verbatim (including its query string) — these params exist so
 * the params editor also reflects them, matching how every other importer
 * surfaces query strings both in the URL and as editable rows. */
function parseQueryParams(request: HarRequest): KeyValue[] {
  return (request.queryString ?? []).map((q) => createTypedKeyValue({ key: q.name, value: q.value, enabled: true }))
}

/** Convert `entry.request.postData` into an `HTTPRequestBody`. Multipart /
 * urlencoded bodies use the structured `params[]` HAR provides when
 * present; anything else (JSON, XML, plain text, or a urlencoded body HAR
 * captured only as raw text) is imported as raw text. */
function parseBody(postData: HarPostData | undefined): HTTPRequestBody | undefined {
  if (!postData || (!postData.text && !postData.params)) return undefined

  const mimeType = (postData.mimeType ?? '').toLowerCase()

  if (mimeType.includes('multipart/form-data')) {
    if (postData.params && postData.params.length > 0) {
      return {
        type: 'form-data',
        fields: postData.params.map((p) =>
          createTypedKeyValue({ key: p.name, value: p.value ?? p.fileName ?? '', enabled: true })
        )
      }
    }
    return { type: 'text', content: postData.text ?? '' }
  }

  if (mimeType.includes('application/x-www-form-urlencoded')) {
    if (postData.params && postData.params.length > 0) {
      return {
        type: 'x-www-form-urlencoded',
        fields: postData.params.map((p) => createTypedKeyValue({ key: p.name, value: p.value ?? '', enabled: true }))
      }
    }
    const fields: KeyValue[] = []
    for (const [key, value] of new URLSearchParams(postData.text ?? '')) {
      fields.push(createTypedKeyValue({ key, value, enabled: true }))
    }
    return { type: 'x-www-form-urlencoded', fields }
  }

  return { type: 'text', content: postData.text ?? '' }
}

/** Friendly display name for an entry — HAR carries no request name, so
 * "METHOD /path" (mirroring the browser devtools Network tab) is the most
 * recognisable label. Falls back to the full URL when it doesn't parse. */
function entryName(method: string, url: string): string {
  try {
    const parsed = new URL(url)
    return `${method} ${parsed.pathname || '/'}`
  } catch {
    return `${method} ${url}`
  }
}

/** Convert one HAR entry into an `HTTPRequest`. `idSeed` must be unique
 * per entry (position-derived) — v1 imports every entry as a distinct
 * request, including repeated calls to the same method + URL, so the id
 * can't be derived from method + url alone without colliding. */
function entryToHTTPRequest(entry: HarEntry, idSeed: string): HTTPRequest {
  const { request } = entry
  const method = toHTTPMethod(request.method)

  const httpRequest: HTTPRequest = {
    type: 'http',
    id: generateId(idSeed),
    name: entryName(method, request.url),
    tags: [],
    method,
    url: request.url,
    headers: parseHeaders(request),
    params: parseQueryParams(request)
  }

  const body = parseBody(request.postData)
  if (body) {
    httpRequest.body = body
  }

  return httpRequest
}

/** Resolve a HAR page's display name from `log.pages` (falling back to the
 * raw `pageref` when the page carries no title, or wasn't declared). */
function pageTitle(pages: HarPage[], pageref: string): string {
  const title = pages.find((p) => p.id === pageref)?.title
  return title && title.length > 0 ? title : pageref
}

const FALLBACK_FOLDER_NAME = 'Imported from HAR'

interface HarGroup {
  key: string
  entries: HarEntry[]
}

/** Group entries by pageref, preserving first-seen order. Entries with no
 * pageref land in a synthetic group keyed by the fallback name itself. Shared
 * by `importHar` (materialises the folder tree) and
 * `pairHarEntriesWithRequestIds` (recomputes the same request ids for
 * response-history seeding) so the two never drift out of sync. */
function computeHarGroups(entries: HarEntry[]): HarGroup[] {
  const groups = new Map<string, HarEntry[]>()
  for (const entry of entries) {
    const key = entry.pageref ?? FALLBACK_FOLDER_NAME
    const group = groups.get(key)
    if (group) group.push(entry)
    else groups.set(key, [entry])
  }
  return Array.from(groups.entries()).map(([key, groupEntries]) => ({ key, entries: groupEntries }))
}

/** Deterministic id seed for one entry — position-derived (see
 * `entryToHTTPRequest`'s doc comment for why method+url alone isn't enough). */
function entryIdSeed(folderKey: string, index: number, entry: HarEntry): string {
  return `har:request:${folderKey}:${index}:${entry.request.method}:${entry.request.url}`
}

// ============================================================================
// Main Service
// ============================================================================

export interface HarImportOptions {
  /**
   * Existing EnvironmentFolder to add the imported requests to.
   * If not provided, a new EnvironmentFolder will be created as root.
   */
  environmentFolder?: EnvironmentFolder
  /**
   * Parent folder where requests will be imported.
   * If provided with environmentFolder, requests will be imported here instead of environmentFolder.
   */
  parentFolder?: Folder
  /** Original URL/path the HAR was fetched or read from. */
  sourceUrl?: string
}

/**
 * Import a HAR (HTTP Archive) document and convert it to a Folder structure.
 */
export function importHar(har: HarFile, options: HarImportOptions = {}): EnvironmentFolder {
  // `har` arrives from untrusted JSON — the `HarFile` type describes the
  // expected shape, but a malformed file needs a real runtime check rather
  // than a TypeError deep inside the entry loop.
  const rawLog = (har as { log?: unknown } | undefined)?.log as { entries?: unknown } | undefined
  if (!rawLog || !Array.isArray(rawLog.entries)) {
    throw new Error('Invalid HAR file: missing log.entries')
  }
  const log = har.log
  const pages = log.pages ?? []
  const groups = computeHarGroups(log.entries)

  const buildRequests = (entries: HarEntry[], folderKey: string): HTTPRequest[] =>
    entries.map((entry, index) => entryToHTTPRequest(entry, entryIdSeed(folderKey, index, entry)))

  // A single group (one page, or no page information at all) imports flat
  // — a lone sub-folder mirroring the root would just be redundant nesting.
  let items: (Folder | HTTPRequest)[]
  if (groups.length === 1) {
    const onlyGroup = groups[0]
    if (!onlyGroup) throw new Error('unreachable: groups.length === 1')
    items = buildRequests(onlyGroup.entries, onlyGroup.key)
  } else {
    items = groups.map(({ key: pageref, entries }) => {
      const name = pageref === FALLBACK_FOLDER_NAME ? FALLBACK_FOLDER_NAME : pageTitle(pages, pageref)
      return new Folder({
        id: generateId(`har:folder:${pageref}`),
        name,
        tags: [],
        configuration: {},
        items: buildRequests(entries, pageref)
      })
    })
  }

  // Case: parentFolder provided without environmentFolder - error
  if (options.parentFolder && !options.environmentFolder) {
    throw new Error('parentFolder requires an environmentFolder to store the imported requests')
  }

  // Case: environmentFolder provided (with or without parentFolder)
  if (options.environmentFolder) {
    const targetFolder = options.parentFolder ?? options.environmentFolder
    targetFolder.items = [...targetFolder.items, ...items]
    return options.environmentFolder
  }

  // Case: no options - create a new EnvironmentFolder as root
  const rootName = groups.length === 1 && pages.length === 1 && pages[0] ? pageTitle(pages, pages[0].id) : FALLBACK_FOLDER_NAME

  const rootFolder: EnvironmentFolder = {
    folderType: 'environment',
    fileFormatVersion: CURRENT_FILE_FORMAT_VERSION,
    importSource: 'har',
    id: generateId(`har:root:${options.sourceUrl ?? rootName}`),
    name: rootName,
    tags: [],
    configuration: {},
    environments: [],
    items
  }

  return rootFolder
}

/**
 * Import a HAR file from a JSON string.
 */
export function importHarFromJson(json: string, options: HarImportOptions = {}): EnvironmentFolder {
  const har = JSON.parse(json) as HarFile
  return importHar(har, options)
}

// ============================================================================
// Response history seeding
// ============================================================================
//
// A HAR is a RECORDING — request AND response pairs — so replaying the
// captured responses into the request's history is the point of importing
// one; without it the user gets an empty history and has to re-run every
// request just to see what the capture already showed them.
//
// `parse()` above stays a pure, synchronous function (the shared
// `ImportProvider` contract every format implements): it never touches
// `ResponseHistoryService` (async, disk-backed) itself. Seeding is a
// SEPARATE, opt-in step a caller runs once the imported requests' real ids
// are known — `pairHarEntriesWithRequestIds` recomputes the exact same ids
// `importHar` stamped (same grouping + seed logic), so a caller that kept
// the parser's ids (e.g. the MCP import tool, which inserts `parse()`'s
// output into the collection store unchanged) can seed history correctly.
// A caller that regenerates ids after parsing (e.g. the renderer's
// drag-and-drop import flow) cannot use this — there is no importer-side
// way to know a regenerated id ahead of time.

/** One HAR entry paired with the request id `importHar` would give it. */
export interface HarResponseSeed {
  requestId: string
  entry: HarEntry
}

/**
 * Recompute the `{ requestId, entry }` pairing for every entry in a HAR
 * document, without materialising the folder tree. Shares `computeHarGroups`
 * + `entryIdSeed` with `importHar` so the ids are always identical to what a
 * fresh `importHar(har)` call on the same document would produce.
 */
export function pairHarEntriesWithRequestIds(har: HarFile): HarResponseSeed[] {
  const groups = computeHarGroups(har.log.entries)
  const pairs: HarResponseSeed[] = []
  for (const group of groups) {
    group.entries.forEach((entry, index) => {
      pairs.push({ requestId: generateId(entryIdSeed(group.key, index, entry)), entry })
    })
  }
  return pairs
}

/** Convert a HAR entry's `response` into the shape `ResponseHistoryService`
 * expects from a live HTTP execution. Only the response side is populated —
 * `ResponseHistoryService.buildHttpResponse` resolves the request side
 * (method/URL/headers/params/body) by looking the request up in the
 * collection store via `requestId`, which is why seeding must run AFTER the
 * imported request is actually in the store. */
function harEntryToExecutionResult(requestId: string, entry: HarEntry): HTTPExecutionResult | null {
  const { response } = entry
  if (!response) return null

  const headers: Record<string, string> = {}
  for (const h of response.headers ?? []) headers[h.name.toLowerCase()] = h.value

  return {
    requestId,
    success: response.status < 400,
    statusCode: response.status,
    ...(response.statusText !== undefined ? { statusText: response.statusText } : {}),
    headers,
    body: response.content?.text ?? '',
    ...(response.content?.encoding === 'base64' ? { bodyIsBase64: true } : {}),
    timings: {
      startedAt: entry.startedDateTime ?? new Date(0).toISOString(),
      durationMs: entry.time ?? 0
    },
    requestUrl: entry.request.url
  }
}

/**
 * Seed the response-history store from every entry in a HAR document that
 * carries a `response`. `requestId`s must already resolve in the collection
 * store (see the module doc above) — call this AFTER the imported items are
 * inserted, not from inside `parse()`.
 *
 * `ResponseHistoryService` is imported dynamically (not at module top-level):
 * this file self-registers into the shared import-provider registry via a
 * side-effect import (`providers.ts`), so every consumer of that registry —
 * including plain format-detection tests for OTHER formats — loads this
 * module. `ResponseHistoryService` pulls in `CollectionStore` and its
 * module-load-time singletons; deferring the import here keeps that heavy
 * chain out of the registry's load path for callers that never seed history.
 */
export async function seedResponseHistoryFromHar(har: HarFile): Promise<void> {
  const { responseHistoryService } = await import('../ResponseHistoryService')
  for (const { requestId, entry } of pairHarEntriesWithRequestIds(har)) {
    const result = harEntryToExecutionResult(requestId, entry)
    if (!result) continue
    await responseHistoryService.storeExecutionResult(requestId, 'http', result)
  }
}

// ============================================================================
// Provider registration
// ============================================================================

import { importProviders } from './registry'

function canImport(content: string, filePath?: string): boolean {
  const trimmed = content.trim()
  let json: unknown
  try {
    json = JSON.parse(trimmed)
  } catch {
    return false
  }
  if (typeof json !== 'object' || json === null || !('log' in json)) return false
  const log = (json as Record<string, unknown>).log
  if (typeof log !== 'object' || log === null) return false
  const { version, entries } = log as Record<string, unknown>
  if (typeof version === 'string') return true
  // Some producers omit the (technically required) `version` field — fall
  // back to the file extension + entries array as a shape confirmation.
  return (filePath ?? '').toLowerCase().endsWith('.har') && Array.isArray(entries)
}

importProviders.push({ format: 'har', canImport, parse: (content, opts) => importHarFromJson(content, opts) })
