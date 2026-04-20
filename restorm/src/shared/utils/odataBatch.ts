/**
 * OData $batch multipart/mixed serialization + parsing.
 *
 * v4 $batch carries a sequence of sub-requests inside a single POST
 * body with `Content-Type: multipart/mixed; boundary=<uuid>`. Each
 * sub-request is itself an HTTP request wrapped in the multipart
 * envelope. The server replies with the same shape: one multipart
 * body, one part per sub-response.
 *
 * This file ships pure, browser+node-friendly helpers so both the
 * renderer (for building the body client-side) and unit tests can
 * exercise the format without a live server.
 *
 * Change-sets (atomicity groups) are *not* covered in Phase 5a — all
 * sub-requests are flat parts for now. Wrapping a subset into a
 * `multipart/mixed; boundary=changeset_<id>` nested body is additive
 * and lands in Phase 5b.
 */

export interface ODataBatchSubRequest {
  /** HTTP method: GET, POST, PATCH, DELETE, PUT. */
  method: string
  /** Relative or absolute URL for the sub-request. */
  url: string
  /** Optional request headers. Content-Type defaults to
   * `application/json` for non-GET when a body is present. */
  headers?: Record<string, string>
  /** Optional request body — raw string, serialized as JSON upstream
   * when applicable. */
  body?: string
}

export interface ODataBatchSubResponse {
  /** HTTP status code from the sub-request. `0` when the multipart
   * status line couldn't be parsed. */
  status: number
  /** Status line reason phrase (may be empty). */
  statusText: string
  /** Headers of the sub-response, lower-cased keys. */
  headers: Record<string, string>
  /** Raw response body as a string. JSON parsing is up to the caller. */
  body: string
}

export interface ODataBatchSerializationResult {
  /** Exact value to use as the outer `Content-Type` header. */
  contentType: string
  /** The full request body. */
  body: string
  /** The boundary token used. Useful for tests / logging. */
  boundary: string
}

/**
 * Serialize a list of sub-requests into an OData v4 multipart/mixed
 * batch body. Uses `\r\n` line separators as the spec requires.
 *
 * The caller is responsible for URL-encoding and for having resolved
 * any env / handlebars templates — this helper treats each
 * sub-request as already-concrete.
 */
export function serializeODataBatch(
  subRequests: readonly ODataBatchSubRequest[],
  boundaryOverride?: string
): ODataBatchSerializationResult {
  const boundary = boundaryOverride ?? `batch_${generateBoundaryToken()}`
  const parts: string[] = []

  for (const sub of subRequests) {
    parts.push(`--${boundary}`)
    parts.push('Content-Type: application/http')
    parts.push('Content-Transfer-Encoding: binary')
    parts.push('') // blank line between envelope headers and the inner request

    const methodUpper = sub.method.toUpperCase()
    parts.push(`${methodUpper} ${sub.url} HTTP/1.1`)

    const mergedHeaders: Record<string, string> = { ...(sub.headers ?? {}) }
    if (sub.body !== undefined && sub.body !== '' && !hasHeader(mergedHeaders, 'content-type')) {
      mergedHeaders['Content-Type'] = 'application/json'
    }
    for (const [k, v] of Object.entries(mergedHeaders)) {
      parts.push(`${k}: ${v}`)
    }

    parts.push('') // blank line between inner headers and inner body
    parts.push(sub.body ?? '')
  }

  parts.push(`--${boundary}--`)
  parts.push('') // trailing CRLF

  return {
    contentType: `multipart/mixed; boundary=${boundary}`,
    body: parts.join('\r\n'),
    boundary
  }
}

/**
 * Parse a multipart/mixed response body into per-sub-response
 * entries. `boundary` is the exact token the server sent in its
 * `Content-Type` header (including any `batchresponse_…` prefix the
 * server chose — we don't require it to match the request boundary).
 *
 * Malformed parts are emitted as best-effort `{ status: 0, body: ... }`
 * entries so the caller sees what came back instead of throwing.
 */
export function parseODataBatchResponse(
  rawBody: string,
  boundary: string
): ODataBatchSubResponse[] {
  if (!boundary) return []
  const marker = `--${boundary}`
  const chunks = rawBody.split(marker).map((c) => trimLeadingCRLF(c))
  const results: ODataBatchSubResponse[] = []

  for (const chunk of chunks) {
    // Terminator / preamble / epilogue: skip. The terminator is
    // `--` optionally followed by CRLF+trailing noise.
    if (chunk === '' || chunk.startsWith('--')) continue

    // Each chunk is an application/http envelope:
    //   Content-Type: application/http
    //   Content-Transfer-Encoding: binary
    //   <CRLF>
    //   HTTP/1.1 200 OK
    //   Header: value
    //   <CRLF>
    //   <body>
    const envelopeEnd = chunk.indexOf('\r\n\r\n')
    if (envelopeEnd < 0) continue
    const innerStart = envelopeEnd + 4
    const httpChunk = chunk.slice(innerStart)

    const headersEnd = httpChunk.indexOf('\r\n\r\n')
    const headerBlock = headersEnd >= 0 ? httpChunk.slice(0, headersEnd) : httpChunk
    const bodyBlock = headersEnd >= 0 ? httpChunk.slice(headersEnd + 4) : ''

    const lines = headerBlock.split('\r\n')
    const statusLine = lines.shift() ?? ''
    const statusMatch = /^HTTP\/\d+\.\d+\s+(\d+)\s*(.*)$/.exec(statusLine)
    const status = statusMatch ? Number(statusMatch[1]) : 0
    const statusText = statusMatch ? (statusMatch[2] ?? '').trim() : ''

    const headers: Record<string, string> = {}
    for (const line of lines) {
      const idx = line.indexOf(':')
      if (idx < 0) continue
      const key = line.slice(0, idx).trim().toLowerCase()
      const value = line.slice(idx + 1).trim()
      if (key) headers[key] = value
    }

    // Strip trailing CRLF left by the split boundary.
    const body = bodyBlock.replace(/\r?\n$/, '')

    results.push({ status, statusText, headers, body })
  }

  return results
}

/**
 * Extract the boundary from a `Content-Type: multipart/mixed;
 * boundary=<token>` header value. Returns `null` when the header is
 * missing or isn't a multipart one.
 */
export function extractBoundary(contentTypeHeader: string | undefined): string | null {
  if (!contentTypeHeader) return null
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/.exec(contentTypeHeader)
  if (!match) return null
  return match[1] ?? match[2] ?? null
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase()
  return Object.keys(headers).some((k) => k.toLowerCase() === lower)
}

function trimLeadingCRLF(chunk: string): string {
  return chunk.replace(/^\r?\n+/, '')
}

function generateBoundaryToken(): string {
  // Not security-sensitive — just needs to be unlikely to collide with
  // sub-request content. Timestamp + 6-char random is fine for tests
  // and real traffic alike.
  const rand = Math.random().toString(36).slice(2, 8)
  return `${Date.now().toString(36)}_${rand}`
}
