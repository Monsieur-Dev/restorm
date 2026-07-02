/**
 * Compose the HTTP method + request body for a tRPC v10 non-batch call.
 *
 * Single source of truth shared by BOTH dispatch paths so they produce
 * byte-identical wire bodies:
 *   - the request-panel Send (renderer `handleSend` → `trpc:execute` IPC), and
 *   - the scenario engine (`httpRequestExecutor` tRPC branch).
 *
 * The URL itself (`<base>/<procedure>`, plus `?input=<encoded>` for a query)
 * is composed elsewhere (`URLResolver`, mirroring the OData system-query-
 * option append) — this only owns the verb + body:
 *   - query: GET, no body — the input rides the URL.
 *   - mutation: POST `{ "0": { "json": <input> } }` (v10 non-batch envelope),
 *     or `{ "0": {} }` for a no-input procedure.
 *
 * The raw `input` text is embedded VERBATIM (not JSON.parse/stringify
 * round-tripped) so a `{{handlebars}}` placeholder inside it survives to the
 * final string-level resolution `HTTPExecutionService` performs on the whole
 * `rawBody` — the same reason `composeODataRequestBody` passes `actionBody`
 * through untouched.
 */

export interface TrpcBodySource {
  kind?: string
  input?: string
}

export interface TrpcComposedBody {
  /** Verb to dispatch: GET for a query (input rides the URL), POST for a
   * mutation. */
  method: string
  /** Raw request body — set only for a mutation. */
  rawBody?: string
  /** Content-Type to set alongside `rawBody`. */
  rawBodyContentType?: string
}

/**
 * Compose `{ method, rawBody?, rawBodyContentType? }` for a tRPC request.
 */
export function composeTrpcRequestBody(request: TrpcBodySource): TrpcComposedBody {
  if (request.kind !== 'mutation') {
    return { method: 'GET' }
  }
  const raw = (request.input ?? '').trim()
  const envelope = raw.length > 0 ? `{"0":{"json":${raw}}}` : '{"0":{}}'
  return { method: 'POST', rawBody: envelope, rawBodyContentType: 'application/json' }
}

/**
 * Parse the v10 non-batch response envelope `[{ result: { data } }]` and
 * return its `data`, or `undefined` when the body isn't shaped that way
 * (an `[{ error }]` envelope, a transport failure, or a non-JSON body — the
 * caller still has the raw text alongside this for a "Show raw envelope"
 * toggle / debugging).
 */
export function unwrapTrpcEnvelope(rawBody: string | undefined): unknown {
  if (!rawBody) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return undefined
  const first = parsed[0] as { result?: { data?: unknown } } | undefined
  if (!first || typeof first !== 'object' || !('result' in first)) return undefined
  return first.result.data
}

/**
 * Extract a human-readable message from a v10 non-batch error envelope
 * `[{ error: { json: { message, code } } }]` — a tRPC-level error (e.g. a
 * procedure throwing `NOT_FOUND`), distinct from a transport failure (which
 * `HTTPExecutionService` already surfaces on `result.error`; a completed
 * HTTP response, even a 4xx/5xx one, is NOT a transport failure). Returns
 * `undefined` for a success envelope, a non-JSON body, or a shape this
 * importer/executor doesn't recognise — the raw envelope stays available via
 * the "Show raw envelope" toggle either way.
 */
export function unwrapTrpcError(rawBody: string | undefined): string | undefined {
  if (!rawBody) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return undefined
  const first = parsed[0] as { error?: { json?: { message?: string; code?: string } } } | undefined
  const errJson = first?.error?.json
  if (!errJson) return undefined
  return errJson.code ? `${errJson.code}: ${errJson.message ?? ''}` : errJson.message ?? 'tRPC error'
}
