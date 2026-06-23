/**
 * OData $batch multipart/mixed serialization + parsing.
 *
 * v4 $batch carries a sequence of sub-requests inside a single POST
 * body with `Content-Type: multipart/mixed; boundary=<uuid>`. Each
 * sub-request is itself an HTTP request wrapped in the multipart
 * envelope. The server replies with the same shape: one multipart
 * body, one part per sub-response.
 *
 * v4 also defines a JSON batch format (`OData-Version: 4.0`):
 * `{ "requests": [ { id, method, url, headers, body, atomicityGroup } ] }`
 * with a symmetric `{ "responses": [ … ] }` reply. It is far easier to
 * read and debug than the multipart envelope, so the request panel
 * offers a multipart/JSON toggle; the JSON helpers live alongside the
 * multipart ones below (`serializeODataJsonBatch` /
 * `parseODataJsonBatchResponse`).
 *
 * This file ships pure, browser+node-friendly helpers so both the
 * renderer (for building the body client-side) and unit tests can
 * exercise the format without a live server.
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
  /** Optional atomicity group label. Sub-requests sharing the same
   * label are serialized inside one nested `multipart/mixed;
   * boundary=changeset_<id>` envelope so the server commits them as
   * a single transaction. */
  atomicityGroup?: string
  /** Per-child escape hatch: force this GET into the change-set even
   * when the batch-level `allowGetInChangeSet` is false. Only
   * meaningful when `method === 'GET'` and `atomicityGroup` is set. */
  forceIncludeInChangeSet?: boolean
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
  /** Human-readable warnings emitted during serialization. Currently
   * populated when a GET sub-request appears inside a change-set and
   * `allowGetInChangeSet` is not set. The batch is still emitted; the
   * warnings are surfaced in the UI so the user understands the risk. */
  warnings: string[]
}

/**
 * Convert an absolute sub-request URL to a relative URL by stripping
 * the OData service root. Used by v4.01 batch serializers to emit
 * relative URIs as the spec strongly prefers.
 *
 * Strips the service root with a trailing slash, e.g.:
 *   `https://example.com/odata/Customers(1)` with root
 *   `https://example.com/odata` → `Customers(1)`.
 *
 * If `url` does not begin with `serviceRoot` (case-insensitive), or
 * `serviceRoot` is empty, the original URL is returned unchanged so
 * callers never produce a malformed request.
 */
export function toRelativeBatchUrl(url: string, serviceRoot: string): string {
  if (!serviceRoot) return url
  // Normalise: ensure root ends with exactly one slash.
  const root = serviceRoot.endsWith('/') ? serviceRoot : `${serviceRoot}/`
  if (url.toLowerCase().startsWith(root.toLowerCase())) {
    return url.slice(root.length)
  }
  return url
}

/**
 * Serialize a list of sub-requests into an OData v4 multipart/mixed
 * batch body. Uses `\r\n` line separators as the spec requires.
 *
 * The caller is responsible for URL-encoding and for having resolved
 * any env / handlebars templates — this helper treats each
 * sub-request as already-concrete.
 *
 * When `allowGetInChangeSet` is false (default) and a GET appears
 * inside a change-set, the sub-request is still emitted as-is (so
 * the server's rejection is visible) but a human-readable entry is
 * pushed to `result.warnings` for the UI to surface.
 */
export function serializeODataBatch(
  subRequests: readonly ODataBatchSubRequest[],
  boundaryOverride?: string,
  options?: {
    allowGetInChangeSet?: boolean
    /** Strip the service-root prefix from sub-request URLs to produce
     * relative URIs as the v4.01 spec prefers. Provide the bare
     * service root (e.g. `https://example.com/odata`). Ignored when
     * `forceAbsoluteUrls` is true. */
    serviceRoot?: string
    /** When true, sub-request URLs are kept absolute even for v4.01.
     * Useful when the target server requires absolute URIs. */
    forceAbsoluteUrls?: boolean
  }
): ODataBatchSerializationResult {
  const boundary = boundaryOverride ?? `batch_${generateBoundaryToken()}`
  const allowGet = options?.allowGetInChangeSet ?? false
  const resolvedServiceRoot =
    !options?.forceAbsoluteUrls &&
    typeof options?.serviceRoot === 'string' &&
    options.serviceRoot.length > 0
      ? options.serviceRoot
      : ''
  const shouldRelativize = resolvedServiceRoot.length > 0
  const parts: string[] = []
  const warnings: string[] = []

  // Group consecutive sub-requests by `atomicityGroup`. Same label
  // ⇒ one nested changeset; empty / undefined ⇒ standalone. Non-
  // consecutive entries with the same label open separate changesets
  // so the UI's visible order wins over label-grouping.
  interface Group { label: string | undefined; items: ODataBatchSubRequest[] }
  const groups: Group[] = []
  for (const sub of subRequests) {
    const label = sub.atomicityGroup && sub.atomicityGroup.length > 0 ? sub.atomicityGroup : undefined
    const last = groups[groups.length - 1]
    if (last?.label !== undefined && last.label === label) {
      last.items.push(sub)
    } else {
      groups.push({ label, items: [sub] })
    }
  }

  /** Rewrite a sub-request's URL to relative when enabled. */
  const maybeMakeRelative = (sub: ODataBatchSubRequest): ODataBatchSubRequest => {
    if (!shouldRelativize) return sub
    const relUrl = toRelativeBatchUrl(sub.url, resolvedServiceRoot)
    if (relUrl === sub.url) return sub
    return { ...sub, url: relUrl }
  }

  for (const group of groups) {
    if (group.label === undefined) {
      // Standalone sub-request — inline directly.
      for (const sub of group.items) {
        appendSubRequestPart(parts, boundary, maybeMakeRelative(sub))
      }
      continue
    }

    // Nested changeset envelope.
    const changesetBoundary = `changeset_${generateBoundaryToken()}`
    parts.push(`--${boundary}`)
    parts.push(`Content-Type: multipart/mixed; boundary=${changesetBoundary}`)
    parts.push('')
    for (const sub of group.items) {
      // GET inside a change-set is spec-non-conformant. Warn when
      // neither the batch-level flag nor the per-child override
      // explicitly opts in, then include it anyway so the server
      // response (likely a 4xx) is visible to the user.
      if (
        sub.method.toUpperCase() === 'GET' &&
        !allowGet &&
        !sub.forceIncludeInChangeSet
      ) {
        warnings.push(
          `GET "${sub.url}" is inside change-set "${group.label}". ` +
          'The OData spec forbids GET inside a change-set; many servers will reject this batch. ' +
          'Enable "Allow GET in change-set" to suppress this warning.'
        )
      }
      appendSubRequestPart(parts, changesetBoundary, maybeMakeRelative(sub))
    }
    parts.push(`--${changesetBoundary}--`)
  }

  parts.push(`--${boundary}--`)
  parts.push('') // trailing CRLF

  return {
    contentType: `multipart/mixed; boundary=${boundary}`,
    body: parts.join('\r\n'),
    boundary,
    warnings
  }
}

function appendSubRequestPart(parts: string[], boundary: string, sub: ODataBatchSubRequest): void {
  parts.push(`--${boundary}`)
  parts.push('Content-Type: application/http')
  parts.push('Content-Transfer-Encoding: binary')
  parts.push('')

  const methodUpper = sub.method.toUpperCase()
  parts.push(`${methodUpper} ${sub.url} HTTP/1.1`)

  const mergedHeaders: Record<string, string> = { ...(sub.headers ?? {}) }
  if (sub.body !== undefined && sub.body !== '' && !hasHeader(mergedHeaders, 'content-type')) {
    mergedHeaders['Content-Type'] = 'application/json'
  }
  for (const [k, v] of Object.entries(mergedHeaders)) {
    parts.push(`${k}: ${v}`)
  }

  parts.push('')
  parts.push(sub.body ?? '')
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

// ============================================================================
// JSON batch (OData v4) serialization + parsing
// ============================================================================

export interface ODataJsonBatchSerializationResult {
  /** Always `application/json` for the JSON batch format. */
  contentType: string
  /** The full request body — a JSON `{ "requests": [...] }` document. */
  body: string
}

/**
 * Serialize sub-requests into an OData v4 JSON batch body.
 *
 * Each sub-request becomes one `requests[]` entry with a unique `id`.
 * Sub-requests sharing an `atomicityGroup` are emitted with that label
 * verbatim so the server commits them transactionally — same grouping
 * contract as the multipart path, but the server reads it off the JSON
 * `atomicityGroup` member instead of a nested `changeset_…` boundary.
 *
 * The body is parsed as JSON when present and a string; otherwise it is
 * passed through as-is (so a raw, already-stringified body still works).
 * The caller is responsible for having resolved env / Handlebars
 * templates first — every field here is treated as concrete.
 */
export function serializeODataJsonBatch(
  subRequests: readonly ODataBatchSubRequest[],
  options?: {
    /** Strip the service-root prefix from sub-request URLs (v4.01 relative URIs). */
    serviceRoot?: string
    /** When true, URLs are kept absolute even for v4.01. */
    forceAbsoluteUrls?: boolean
  }
): ODataJsonBatchSerializationResult {
  const resolvedServiceRoot =
    !options?.forceAbsoluteUrls &&
    typeof options?.serviceRoot === 'string' &&
    options.serviceRoot.length > 0
      ? options.serviceRoot
      : ''
  const shouldRelativize = resolvedServiceRoot.length > 0

  const requests = subRequests.map((sub, index) => {
    const id = String(index + 1)
    const resolvedUrl = shouldRelativize
      ? toRelativeBatchUrl(sub.url, resolvedServiceRoot)
      : sub.url
    const entry: Record<string, unknown> = {
      id,
      method: sub.method.toUpperCase(),
      url: resolvedUrl
    }
    if (sub.atomicityGroup && sub.atomicityGroup.length > 0) {
      entry['atomicityGroup'] = sub.atomicityGroup
    }
    const headers = { ...(sub.headers ?? {}) }
    if (sub.body !== undefined && sub.body !== '' && !hasHeader(headers, 'content-type')) {
      headers['Content-Type'] = 'application/json'
    }
    if (Object.keys(headers).length > 0) {
      // JSON batch wants lower-cased header names per the spec example.
      entry['headers'] = Object.fromEntries(
        Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
      )
    }
    if (sub.body !== undefined && sub.body !== '') {
      entry['body'] = parseBodyForJsonBatch(sub.body)
    }
    return entry
  })

  return {
    contentType: 'application/json',
    body: JSON.stringify({ requests }, null, 2)
  }
}

/**
 * Parse an OData v4 JSON batch response (`{ "responses": [...] }`) into
 * the same `ODataBatchSubResponse[]` shape the multipart parser emits,
 * so the response panel renders both formats identically.
 *
 * Responses are returned in the order the server sent them (it may
 * reorder vs the request when `dependsOn` is used). A body that came
 * back as a JSON object/array is re-stringified so the `body` field
 * stays a string, matching the multipart contract. Malformed input
 * yields `[]` rather than throwing.
 */
export function parseODataJsonBatchResponse(rawBody: string): ODataBatchSubResponse[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return []
  }
  if (parsed === null || typeof parsed !== 'object') return []
  const responses = (parsed as Record<string, unknown>)['responses']
  if (!Array.isArray(responses)) return []

  const results: ODataBatchSubResponse[] = []
  for (const item of responses) {
    if (item === null || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    const status = typeof obj['status'] === 'number' ? obj['status'] : 0
    const headers: Record<string, string> = {}
    const rawHeaders = obj['headers']
    if (rawHeaders !== null && typeof rawHeaders === 'object') {
      for (const [k, v] of Object.entries(rawHeaders as Record<string, unknown>)) {
        headers[k.toLowerCase()] = String(v)
      }
    }
    const rawResponseBody = obj['body']
    const body = rawResponseBody === undefined
      ? ''
      : typeof rawResponseBody === 'string'
        ? rawResponseBody
        : JSON.stringify(rawResponseBody)
    results.push({ status, statusText: '', headers, body })
  }
  return results
}

/** Best-effort: a JSON object/array body is inlined as a real JSON
 * value (so the batch document nests it rather than double-encoding a
 * string); anything else is left as the raw string the caller gave. */
function parseBodyForJsonBatch(body: string): unknown {
  const trimmed = body.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return body
    }
  }
  return body
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
