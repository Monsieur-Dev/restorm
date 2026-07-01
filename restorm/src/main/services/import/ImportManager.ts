/**
 * ImportManager - Orchestrates all import services
 *
 * This service:
 * - Reads files from filesystem or fetches from URLs
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
import { withFirewallBypass } from 'electron-core-ui'
import { assertSafeFetchUrl } from '../../utils/urlSecurity'

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

/** Cap on import redirect hops — generous for real APIs, bounded vs. a loop. */
const MAX_IMPORT_REDIRECTS = 5

/**
 * Fetch `url`, following redirects MANUALLY so every hop is re-validated by the
 * SSRF guard in STRICT mode (`allowPrivateHosts` is NOT carried past the first
 * URL). The top-level import URL may be loopback/private (the user typed it),
 * but a redirect must never be able to pivot to an internal / cloud-metadata
 * target — that is the real SSRF vector. `node-fetch`/undici default to
 * following redirects opaquely, which would bypass the per-hop check.
 *
 * Exported for unit-test coverage; the production call site is `importFrom`.
 */
export async function fetchFollowingSafeRedirects(url: string, init: RequestInit): Promise<Response> {
  let current = url
  for (let hop = 0; hop <= MAX_IMPORT_REDIRECTS; hop++) {
    const response = await fetch(current, { ...init, redirect: 'manual' })
    // 3xx with a Location → a redirect we must re-validate before following.
    const location = response.status >= 300 && response.status < 400
      ? response.headers.get('location')
      : null
    if (location === null) return response
    // Resolve relative redirects against the current URL, then re-assert
    // STRICTLY (no allowPrivateHosts) so the hop can't reach loopback/private/
    // metadata even though the original explicit URL was allowed to.
    const next = new URL(location, current).toString()
    assertSafeFetchUrl(next)
    current = next
  }
  throw new Error(`Too many redirects following the import URL (>${MAX_IMPORT_REDIRECTS})`)
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
  for (const provider of importProviders) {
    if (provider.canImport(content, filePath)) return provider.format
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

/** Import from a given content string with detected or specified format */
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
        error: `Unsupported format: ${format}`
      }
    }

    // filePath: prefer the explicit param (Thrift threads it); else derive from
    // `source` for non-URL imports (compiler-based formats e.g. TypeSpec need disk locality).
    const isUrlSource = source.startsWith('http://') || source.startsWith('https://')
    const opts = {
      ...(sourceUrl !== undefined ? { sourceUrl } : {}),
      ...(filePath !== undefined ? { filePath } : !isUrlSource ? { filePath: source } : {})
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

/** Import from file path or URL */
export async function importFrom(
  input: string,
  options: ImportOptions = {}
): Promise<ImportResult> {
  try {
    let content: string
    let source: string
    let detectedFormat: string | null = null
    let lastStatusCode: number | undefined

    const isUrl = input.startsWith('http://') || input.startsWith('https://')
    // Check if input is a URL
    if (isUrl) {
      source = input

      try {
        // SSRF guard. The top-level import URL is EXPLICIT (the user/agent
        // typed it), so loopback/private hosts are allowed — importing a spec
        // from a local dev server is legitimate — but link-local /
        // cloud-metadata is still blocked. Redirect hops are re-checked
        // STRICTLY below so the explicit URL can't pivot to an internal /
        // metadata target (the real SSRF vector).
        assertSafeFetchUrl(input, { allowPrivateHosts: true })
        const fetchInit: RequestInit = options.extraHeaders && Object.keys(options.extraHeaders).length > 0
          ? { headers: options.extraHeaders }
          : {}
        // Log the full dispatched request (headers redacted for
        // Authorization / Cookie) so auth flows can be diagnosed end
        // to end — which headers reached the target vs. were lost
        // along the way.
        const redactedHeaders: Record<string, string> = {}
        if (options.extraHeaders) {
          for (const [k, v] of Object.entries(options.extraHeaders)) {
            redactedHeaders[k] = /authorization|cookie/i.test(k) ? `${v.slice(0, 12)}…(redacted)` : v
          }
        }
        logger.info('[ImportManager] dispatching fetch', {
          url: input,
          method: 'GET',
          headers: redactedHeaders,
          headerCount: Object.keys(options.extraHeaders ?? {}).length
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
            items: [],
            source,
            statusCode: response.status,
            ...(isAuthError ? { isAuthError: true } : {}),
            error: `HTTP ${response.status}: ${response.statusText}`
          }
        }
        content = await response.text()
      } catch (error) {
        logger.error(`[ImportManager] Failed to fetch URL:`, error)
        return {
          success: false,
          items: [],
          source,
          ...(lastStatusCode !== undefined ? { statusCode: lastStatusCode } : {}),
          error: error instanceof Error ? error.message : String(error)
        }
      }
    } else {
      // Treat as file path
      logger.info(`[ImportManager] Reading from file: ${input}`)
      source = input

      try {
        content = await fs.readFile(input, 'utf-8')
      } catch (error) {
        logger.error(`[ImportManager] Failed to read file:`, error)
        return {
          success: false,
          items: [],
          source,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }

    // Detect format
    detectedFormat = detectFormat(content, input)

    if (!detectedFormat) {
      logger.warn(`[ImportManager] Could not detect format for: ${source}`)
      return {
        success: false,
        items: [],
        source,
        error: 'Could not detect file format'
      }
    }

    // Import using detected format
    const result = await importFromContent(content, detectedFormat, source, isUrl ? input : undefined, isUrl ? undefined : input)
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

/** Try all import services in parallel (for preview/dry-run) */
export async function tryAllImports(
  input: string,
  _options: ImportOptions = {}
): Promise<ImportResult[]> {
  logger.info(`[ImportManager] Trying all import formats for: ${input}`)

  // Try to determine if it's a URL or file path
  let content: string
  let source: string
  const isUrl = input.startsWith('http://') || input.startsWith('https://')

  try {
    if (isUrl) {
      source = input
      // Same firewall bypass rationale as `importFrom` above — user
      // typed / dropped the URL, that's the authorisation signal, and
      // it's an EXPLICIT top-level import URL so loopback/private hosts
      // (a local dev API server) are a legitimate target. The SSRF guard
      // still blocks link-local / cloud-metadata (bypass ≠ unrestricted).
      assertSafeFetchUrl(input, { allowPrivateHosts: true })
      const response = await withFirewallBypass(() => fetch(input))
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      content = await response.text()
    } else {
      source = input
      content = await fs.readFile(input, 'utf-8')
    }
  } catch (error) {
    return [{
      success: false,
      items: [],
      source: input,
      error: error instanceof Error ? error.message : String(error)
    }]
  }

  // Try all registered formats in parallel (registration order = detection priority)
  const formats = importProviders.map(p => p.format)

  const results = await Promise.all(
    formats.map(format => importFromContent(content, format, source, isUrl ? input : undefined, isUrl ? undefined : input))
  )

  // Return only successful results
  return results.filter(r => r.success && r.items.length > 0)
}
