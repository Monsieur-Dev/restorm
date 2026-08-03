/**
 * ImportManager - Orchestrates all import services
 *
 * This service:
 * - Resolves an import `source` into raw content: fetches a URL, reads a
 *   file off disk, or takes the string itself as the payload when the user
 *   pasted / dropped content rather than naming a location
 *   (see `classifyImportSource`)
 * - Detects the format via the provider registry (each *ImportService.ts
 *   self-registers a canImport + parse pair; zero hardcoded branches here)
 * - Dispatches to the matching provider's parse()
 * - Returns parsed results
 *
 * Adding a new import format requires no changes to this file — add a
 * self-registering *ImportService.ts and one line in providers.ts.
 */

import { createHash } from 'node:crypto'
import * as fs from 'fs/promises'
import { logger } from 'electron-core-ui/main'
import type { EnvironmentFolder, FolderItem } from '../../../shared/models'
import { isRequest, isAnyFolder, isHTTPRequest, isAuthenticationRequest, isGraphQLRequest, isGrpcRequest, isSoapRequest, isWebSocketRequest, isODataRequest } from '../../../shared/types/collections'
import { disableEmptyKeyValues } from '../../../shared/utils/emptyKeyValueHelper'
import type { ImportErrorCode, ImportErrorParams } from '../../../shared/config/importErrors'
import { withFirewallBypass } from 'electron-core-ui'
import { assertSafeFetchUrl, fetchFollowingSafeRedirects } from '../../utils/urlSecurity'

// Side-effect import: triggers all provider self-registrations before any
// dispatch call can reach detectFormat or importFromContent.
import { importProviders } from './providers'

// ============================================================================
// Types
// ============================================================================

export interface ImportResult {
  success: boolean
  items: FolderItem[]
  source: string
  format?: string
  error?: string
  /** Machine-readable identity of `error`, when the failure is one the
   * app can name. The renderer renders a localised sentence from it;
   * `error` stays human-readable English for logs and for the MCP
   * tools that hand it straight back to an agent. Absent for text
   * produced outside the app (a parser, the filesystem, the network),
   * which the renderer shows verbatim as diagnostic detail. */
  errorCode?: ImportErrorCode
  /** Parameters for `errorCode`'s sentence. The reserved `detail` key
   * carries untranslatable upstream text. */
  errorParams?: ImportErrorParams
  /** HTTP status code when the import source is a URL. Surfaced so
   * the UI can detect 401 / 403 and prompt for authentication. */
  statusCode?: number
  /** `true` when the fetch failed with a status listed in the
   * active auth-error-code set (defaults to [401, 403]). The UI
   * uses this to decide whether to show the "Add authentication"
   * button. */
  isAuthError?: boolean
  /** SHA-256 of the raw payload the importer parsed (URL or file).
   * Stamped onto the env folder's `apiUpdate.payloadChecksum` so a
   * subsequent Refresh can detect "no change since the import that
   * produced this folder" without re-running the full importer. */
  payloadChecksum?: string
}

export interface ImportOptions {
  dryRun?: boolean
  /** Optional extra headers to inject into the import fetch (for
   * URL-based imports). Callers plug resolved auth headers here
   * after running an AuthenticationRequest via the cache service. */
  extraHeaders?: Record<string, string>
}

// ============================================================================
// Safe redirect-following fetch
// ============================================================================

// ============================================================================
// Source Classification
// ============================================================================

/**
 * How an import `source` string resolves into raw content:
 *
 * - `url`     — fetch it (`http://` / `https://`).
 * - `file`    — read it off disk.
 * - `content` — the string IS the payload. The import modal's source
 *   field doubles as a paste area, and its drop handler falls back to
 *   `text/plain` for a dragged selection, so a curl command / a Postman
 *   collection / an SDL document can arrive here verbatim.
 */
export type ImportSourceKind = 'url' | 'file' | 'content'

/**
 * Upper bound on what can plausibly be a filesystem path. Linux caps a
 * path at 4096 bytes (`PATH_MAX`) and every other platform we ship on is
 * stricter, so anything longer is a payload and never worth a syscall.
 */
const MAX_PATH_LENGTH = 4096

function isUrlSource(input: string): boolean {
  return input.startsWith('http://') || input.startsWith('https://')
}

/**
 * `true` when `input` could be handed to `fs.stat` at all. A pasted
 * document is multi-line and/or far past `PATH_MAX`, so this rejects it
 * without paying for a syscall that would only throw (`ENAMETOOLONG`,
 * or `ERR_INVALID_ARG_VALUE` on an embedded NUL).
 */
function couldBePath(input: string): boolean {
  if (input.length === 0 || input.length > MAX_PATH_LENGTH) return false
  return !/[\n\r\0]/.test(input)
}

/**
 * `true` when `input` is unambiguously path-SHAPED: a single
 * whitespace-free token anchored at a filesystem root — POSIX absolute
 * (`/etc/x`), explicitly relative (`./x`, `../x`), home (`~/x`), a
 * Windows drive (`C:\x`, `C:/x`), or a UNC share (`\\host\share`).
 *
 * Deliberately narrower than "might be a path": a bare `openapi.json`
 * also names a file, but it's equally plausible as the first token of
 * something pasted, so it only counts as a path when it actually exists
 * on disk (see `classifyImportSource`).
 */
function isPathShaped(input: string): boolean {
  if (!couldBePath(input)) return false
  if (/\s/.test(input)) return false
  return /^[/~]/.test(input) || input.startsWith('./') || input.startsWith('../') ||
    /^[A-Za-z]:[\\/]/.test(input) || input.startsWith('\\\\')
}

/**
 * Decide how to resolve an import `source`.
 *
 * The file check is a real `stat` rather than a syntactic guess, because
 * the two candidate readings genuinely overlap: `collection.json` is a
 * plausible filename AND a plausible first line of something pasted.
 * Existence on disk is the only signal that settles it.
 *
 * A path-shaped input that does NOT exist still classifies as `file` on
 * purpose: the user typo'd a location, and the honest answer is the
 * errno naming the file they meant, not the "could not detect format"
 * they'd get from parsing the path string as a document.
 *
 * Exported for unit-test coverage; production call sites stay inside
 * this module (`readImportSource`).
 */
export async function classifyImportSource(input: string): Promise<ImportSourceKind> {
  if (isUrlSource(input)) return 'url'
  if (couldBePath(input)) {
    try {
      if ((await fs.stat(input)).isFile()) return 'file'
    } catch {
      // Not readable / not there — fall through to the shape check.
    }
  }
  if (isPathShaped(input)) return 'file'
  return 'content'
}

// ============================================================================
// Format Detection
// ============================================================================

/**
 * Detect format from content by asking each registered provider in turn.
 * Returns the format string of the first provider whose `canImport` returns
 * `true`, or `null` when none matches.
 *
 * Exported for unit-test coverage; production call sites stay inside this
 * module (`importFrom`, `tryAllImports`).
 */
export function detectFormat(content: string, filePath?: string): string | null {
  // Phase 1 — extension-anchored match wins. A provider whose `canImport`
  // accepts on the filename ALONE (probed here with empty content) has an
  // unambiguous extension signal (e.g. `.thrift`, `.tsp`, `.smithy`, `.proto`)
  // and must beat a greedier CONTENT sniff from an earlier-registered provider.
  // Without this, Smithy's `namespace … service {` sniff steals `.thrift` files
  // and Thrift's `^namespace` sniff steals `.tsp` files, purely because
  // detection is registration-order (co-existence only happens once every
  // importer is merged, so this never surfaces in a single-importer worktree).
  // Content-gated extension checks (Bruno's `.json`, HAR's `.har`) parse first,
  // so they return false on empty content and correctly fall through to Phase 2.
  if (filePath) {
    for (const provider of importProviders) {
      try {
        if (provider.canImport('', filePath)) return provider.format
      } catch {
        // A provider that assumes non-empty content is not an extension-anchored
        // match — ignore and let the content sniff below decide.
      }
    }
  }
  // Phase 2 — content sniff, in registration order (original behaviour).
  // JSON is parsed at most ONCE per pass (not once per JSON-capable
  // provider) and handed to every `canImport` call as `parsed`; providers
  // that sniff a JSON shape read it instead of re-parsing `content`
  // themselves. `undefined` when `content` isn't valid JSON — providers
  // that also accept YAML (OpenAPI, Swagger) fall back to their own
  // JSON-then-YAML parse attempt at that point (see `tryParseSpecText` in
  // `transformers/_shared.ts`); every other provider's own fallback parse
  // is JSON-only and fails identically to this one.
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    parsed = undefined
  }
  for (const provider of importProviders) {
    if (provider.canImport(content, filePath, parsed)) return provider.format
  }
  return null
}

// ============================================================================
// Import Functions
// ============================================================================

/**
 * Walk a freshly-imported folder tree and flip `enabled: false` on
 * every KV row whose value resolves to empty (headers, params,
 * path params, gRPC metadata, SOAP headers). Body fields are left
 * alone — POSTing `{"bio": ""}` is a legitimate "clear this field"
 * payload that the user should manage explicitly.
 */
function disableEmptyKeyValuesInTree(folder: EnvironmentFolder): void {
  const visit = (item: FolderItem): void => {
    if (isRequest(item)) {
      if (isHTTPRequest(item) || isAuthenticationRequest(item)) {
        disableEmptyKeyValues(item.headers)
        disableEmptyKeyValues(item.params)
        disableEmptyKeyValues(item.pathParams)
      } else if (isGraphQLRequest(item)) {
        disableEmptyKeyValues(item.headers)
      } else if (isGrpcRequest(item)) {
        disableEmptyKeyValues(item.metadata)
      } else if (isSoapRequest(item)) {
        disableEmptyKeyValues(item.headers)
      } else if (isWebSocketRequest(item)) {
        disableEmptyKeyValues(item.headers)
      } else if (isODataRequest(item)) {
        disableEmptyKeyValues(item.headers)
        disableEmptyKeyValues(item.params)
      }
      return
    }
    if (isAnyFolder(item)) {
      for (const child of item.items) visit(child)
    }
  }
  for (const child of folder.items) visit(child)
}

/**
 * Import from a given content string with detected or specified format.
 *
 * `filePath` must be passed whenever `source` is a real on-disk path —
 * it's what a provider whose own compiler needs disk locality reads
 * (`ImportProvider.parse`'s `opts.filePath`), and what TypeSpec's
 * file-only gate keys off. It is NOT derived from `source` here: a
 * `source` that isn't a URL can equally be pasted content, and guessing
 * would hand a provider a payload where it expects a path.
 */
export async function importFromContent(
  content: string,
  format: string,
  source: string,
  sourceUrl?: string,
  filePath?: string
): Promise<ImportResult> {
  try {
    logger.info(`[ImportManager] Importing from ${source} as ${format}`)

    const provider = importProviders.find(p => p.format === format)
    if (!provider) {
      return {
        success: false,
        items: [],
        source,
        error: `Unsupported format: ${format}`,
        errorCode: 'unsupportedFormat',
        errorParams: { format }
      }
    }

    const opts = {
      ...(sourceUrl !== undefined ? { sourceUrl } : {}),
      ...(filePath !== undefined ? { filePath } : {})
    }
    // Await the parse result so this function stays genuinely async — callers
    // can rely on the Promise-based API even if all current parsers are sync.
    const folder: EnvironmentFolder = await Promise.resolve(provider.parse(content, opts))

    // Auto-disable empty rows across the freshly-imported tree. Most
    // specs (OpenAPI parameters with no `example` / no `default`,
    // generated headers like `Authorization: ""` waiting for the user
    // to fill them in) produce KV entries whose value resolves to "".
    // Sent over the wire as `?name=&header=` they trigger regex-based
    // 422s on strict APIs. Default is now "create empty rows as
    // disabled" — the user opts in by re-checking the row.
    disableEmptyKeyValuesInTree(folder)

    // Return the folder itself as a single item, not its children
    return {
      success: true,
      items: [folder], // Return the folder itself, not folder.items
      source,
      format
    }
  } catch (error) {
    logger.error(`[ImportManager] Error importing from ${source}:`, error)
    return {
      success: false,
      items: [],
      source,
      format,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

interface ReadSourceResult {
  success: true
  content: string
  /** How `input` was resolved — see `classifyImportSource`. */
  kind: ImportSourceKind
}

interface ReadSourceError {
  success: false
  error: string
  /** Named identity of `error`, when there is one — propagated onto
   * the `ImportResult` so the renderer can localise it. */
  errorCode?: ImportErrorCode
  errorParams?: ImportErrorParams
  statusCode?: number
  isAuthError?: boolean
}

/**
 * Resolve an import `source` into raw content — fetch a URL, read a file,
 * or take the string itself when it's pasted content. Shared by
 * `importFrom` (initial parse) and `runPostImportSeed` (re-reads the same
 * source once the imported items have their final ids, to recover the
 * exact bytes a format's `postImportSeed` needs — see
 * `ImportProvider.postImportSeed` in `registry.ts`; for pasted content
 * that re-read is the paste itself, so its checksum still matches).
 */
async function readImportSource(
  input: string,
  extraHeaders?: Record<string, string>
): Promise<ReadSourceResult | ReadSourceError> {
  const kind = await classifyImportSource(input)

  if (kind === 'content') {
    // The source string IS the payload: a curl command, a collection, an
    // SDL document the user pasted into the modal's source field or
    // dropped on it as a text selection. Nothing to read — handing this
    // to the file branch below is what surfaces an ENOENT quoting the
    // user's own paste back at them.
    logger.info('[ImportManager] Source is pasted content', { length: input.length })
    return { success: true, content: input, kind }
  }

  if (kind === 'url') {
    let lastStatusCode: number | undefined
    try {
      // SSRF guard. The top-level import URL is EXPLICIT (the user/agent
      // typed it), so loopback/private hosts are allowed — importing a spec
      // from a local dev server is legitimate — but link-local /
      // cloud-metadata is still blocked. Redirect hops are re-checked
      // STRICTLY below so the explicit URL can't pivot to an internal /
      // metadata target (the real SSRF vector).
      assertSafeFetchUrl(input, { allowPrivateHosts: true })
      const fetchInit: RequestInit = extraHeaders && Object.keys(extraHeaders).length > 0
        ? { headers: extraHeaders }
        : {}
      // Log the full dispatched request (headers redacted for
      // Authorization / Cookie) so auth flows can be diagnosed end
      // to end — which headers reached the target vs. were lost
      // along the way.
      const redactedHeaders: Record<string, string> = {}
      if (extraHeaders) {
        for (const [k, v] of Object.entries(extraHeaders)) {
          redactedHeaders[k] = /authorization|cookie/i.test(k) ? `${v.slice(0, 12)}…(redacted)` : v
        }
      }
      logger.info('[ImportManager] dispatching fetch', {
        url: input,
        method: 'GET',
        headers: redactedHeaders,
        headerCount: Object.keys(extraHeaders ?? {}).length
      })
      // Import is user-initiated (URL paste / drag-drop on the
      // Import modal) — bypass the firewall so we don't ask the
      // user to authorise the very fetch they just typed a URL
      // for, and so a fresh project with empty `projectOrigins`
      // doesn't dead-end on auto-deny.
      const response = await withFirewallBypass(() => fetchFollowingSafeRedirects(input, fetchInit))
      logger.info('[ImportManager] fetch response', {
        url: input,
        status: response.status,
        statusText: response.statusText
      })
      lastStatusCode = response.status
      if (!response.ok) {
        const isAuthError = response.status === 401 || response.status === 403
        return {
          success: false,
          statusCode: response.status,
          ...(isAuthError ? { isAuthError: true } : {}),
          error: `HTTP ${response.status}: ${response.statusText}`,
          errorCode: 'httpStatus',
          errorParams: { status: String(response.status), detail: response.statusText }
        }
      }
      return { success: true, content: await response.text(), kind }
    } catch (error) {
      logger.error(`[ImportManager] Failed to fetch URL:`, error)
      return {
        success: false,
        ...(lastStatusCode !== undefined ? { statusCode: lastStatusCode } : {}),
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  logger.info(`[ImportManager] Reading from file: ${input}`)
  try {
    return { success: true, content: await fs.readFile(input, 'utf-8'), kind }
  } catch (error) {
    logger.error(`[ImportManager] Failed to read file:`, error)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Import from file path or URL */
export async function importFrom(
  input: string,
  options: ImportOptions = {}
): Promise<ImportResult> {
  try {
    const source = input
    const read = await readImportSource(input, options.extraHeaders)
    if (!read.success) {
      return {
        success: false,
        items: [],
        source,
        ...(read.statusCode !== undefined ? { statusCode: read.statusCode } : {}),
        ...(read.isAuthError ? { isAuthError: true } : {}),
        ...(read.errorCode !== undefined ? { errorCode: read.errorCode } : {}),
        ...(read.errorParams !== undefined ? { errorParams: read.errorParams } : {}),
        error: read.error
      }
    }
    const { content, kind } = read

    // `filePath` is the real on-disk location or nothing — never the raw
    // source string. Passing pasted content as a path would let
    // `detectFormat`'s extension-anchored first pass sniff the payload as
    // a filename, and would defeat the file-only gates downstream
    // providers implement against `opts.filePath`.
    const filePath = kind === 'file' ? input : undefined

    // Detect format
    const detectedFormat = detectFormat(content, filePath)

    if (!detectedFormat) {
      logger.warn(`[ImportManager] Could not detect format for: ${source}`)
      return {
        success: false,
        items: [],
        source,
        error: 'Could not detect file format',
        errorCode: 'formatNotDetected'
      }
    }

    // Import using detected format
    const result = await importFromContent(content, detectedFormat, source, kind === 'url' ? input : undefined, filePath)
    if (result.success) {
      // Stamp the payload checksum on every successful import — the
      // env folder's `apiUpdate.payloadChecksum` is what the Refresh
      // button compares against, so it MUST be computed off exactly
      // the same bytes a future `refresh-fetch` will see. Using the
      // raw response text here (pre-parse) matches what
      // `apiUpdate:refresh-fetch` hashes server-side.
      result.payloadChecksum = `sha256:${createHash('sha256').update(content).digest('hex')}`
    }
    return result
  } catch (error) {
    logger.error(`[ImportManager] Unexpected error:`, error)
    return {
      success: false,
      items: [],
      source: input,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export interface PostImportSeedResult {
  success: boolean
  error?: string
}

/**
 * Run a format's optional `ImportProvider.postImportSeed` step after the
 * imported items have landed with their FINAL ids. Re-reads/re-fetches
 * `source` (the same one `importFrom` originally parsed) instead of caching
 * the raw payload in memory across the preview → commit gap — no
 * session-lifetime state to clean up, and it reuses the same trust model
 * "Refresh from source" already relies on (re-fetching the same URL is
 * assumed safe/idempotent for a spec endpoint).
 *
 * `expectedChecksum` — the `payloadChecksum` the original `importFrom` call
 * stamped — guards against the source having changed in between: a mismatch
 * means the freshly re-read content's parser ids may not line up with
 * `idMap` (which was built against the ORIGINAL preview), so seeding is
 * skipped rather than risk writing history against the wrong request.
 *
 * `idMap` is omitted by callers that inserted `parse()`'s output unchanged
 * (the MCP import tool calls this directly, in-process, with no id
 * regeneration) — the provider's `postImportSeed` treats a missing map as
 * identity.
 *
 * A format with no `postImportSeed` (i.e. every format except HAR today) is
 * a silent no-op success — most importers have nothing to seed.
 */
export async function runPostImportSeed(
  source: string,
  format: string,
  idMap?: Record<string, string>,
  options: { extraHeaders?: Record<string, string>; expectedChecksum?: string } = {}
): Promise<PostImportSeedResult> {
  const provider = importProviders.find((p) => p.format === format)
  if (!provider?.postImportSeed) return { success: true }

  const read = await readImportSource(source, options.extraHeaders)
  if (!read.success) {
    logger.warn('[ImportManager] postImportSeed: re-read of source failed, skipping', { source, format, error: read.error })
    return { success: false, error: read.error }
  }

  if (options.expectedChecksum !== undefined) {
    const checksum = `sha256:${createHash('sha256').update(read.content).digest('hex')}`
    if (checksum !== options.expectedChecksum) {
      logger.warn('[ImportManager] postImportSeed: source changed since import, skipping seed', { source, format })
      return { success: false, error: 'source content changed since import' }
    }
  }

  try {
    await provider.postImportSeed(read.content, idMap)
    return { success: true }
  } catch (error) {
    logger.error('[ImportManager] postImportSeed failed', { source, format, error })
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Try all import services in parallel (for preview/dry-run) */
export async function tryAllImports(
  input: string,
  options: ImportOptions = {}
): Promise<ImportResult[]> {
  logger.info(`[ImportManager] Trying all import formats for: ${input}`)

  // Same three-way source resolution `importFrom` uses, so a pasted
  // payload is tried against every format instead of being read as a
  // path. Also inherits the URL branch's redirect-checked fetch.
  const read = await readImportSource(input, options.extraHeaders)
  if (!read.success) {
    return [{
      success: false,
      items: [],
      source: input,
      error: read.error
    }]
  }
  const { content, kind } = read
  const filePath = kind === 'file' ? input : undefined

  // Try all registered formats in parallel (registration order = detection priority)
  const formats = importProviders.map(p => p.format)

  const results = await Promise.all(
    formats.map(format => importFromContent(content, format, input, kind === 'url' ? input : undefined, filePath))
  )

  // Return only successful results
  return results.filter(r => r.success && r.items.length > 0)
}
