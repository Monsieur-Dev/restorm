/**
 * Builds the `request` half of a request box's `response` port — the request as
 * it ACTUALLY went out.
 *
 * An execution result only reports what the transport happened to echo back
 * (typically the resolved URL and the dispatched headers). Everything else the
 * user needs in order to understand what was sent — query params, path params,
 * the body, and for some protocols the headers themselves — is materialised
 * only when the execution is turned into a history detail, with env vars,
 * Handlebars and any wired slot override already resolved.
 *
 * So the executors merge the two: the dispatched values win (they include what
 * the auth step injected), the detail fills in everything the transport didn't
 * echo. The scheduler copies the resulting object into the run log's `done`
 * entry, which is what makes the origin request readable from the scenario's
 * logs instead of only from the response history.
 */

import type { ResponseHistoryDetail, ResponseHistoryKeyValue } from '../../../shared/types/responseHistory'

/** What the transport itself reported about the dispatched request. */
export interface DispatchedRequest {
  url: string
  method: string
  headers: Record<string, unknown>
}

/**
 * The request-side fields a stored detail materialises. Read structurally
 * rather than per protocol: a protocol whose detail carries none of them simply
 * contributes nothing, and one that grows them later is picked up for free.
 */
interface DetailRequestSide {
  requestHeaders?: ResponseHistoryKeyValue[]
  requestParams?: ResponseHistoryKeyValue[]
  requestPathParams?: ResponseHistoryKeyValue[]
  requestBody?: unknown
}

/**
 * A captured request body, reduced to one shape — or `undefined` when nothing
 * was captured.
 *
 * Two problems are solved here, and solving only the first would hide the
 * second rather than fix it.
 *
 * **Absence is spelled differently per protocol.** The HTTP and GraphQL details
 * declare `requestBody` optional, so an uncaptured body is `undefined`; the SOAP
 * detail declares it a required `string`, so an uncaptured body is `''`. A guard
 * on `undefined` alone lets the SOAP case through and reports `body: ''` on a
 * request that certainly sent an envelope — not merely noisy, but false. The log
 * reports what was resolved; it must not assert an empty body where it has no
 * record of one.
 *
 * **Presence is shaped differently per protocol too.** HTTP and GraphQL carry a
 * structured body; the SOAP detail carries a bare string. This value is a
 * selector surface — the same one the JSON-path picker offers — so an
 * unnormalised union makes `response.request.body.content` resolve on one
 * protocol and be `undefined` on another, for the same conceptual field. A
 * string is therefore lifted into the structured form. The field is new, so this
 * is the only moment the choice is free: every later change breaks an expression
 * somebody has already saved.
 */
function capturedBody(body: unknown): unknown {
  if (body === undefined || body === '') return undefined
  if (typeof body === 'string') return { type: 'text', content: body }
  return body
}

/** Enabled key/value rows → a plain map. Disabled rows never went on the wire,
 * so they are dropped; an empty set yields `undefined` (nothing to show). */
function kvRecord(rows: ResponseHistoryKeyValue[] | undefined): Record<string, string> | undefined {
  if (!rows || rows.length === 0) return undefined
  const out: Record<string, string> = {}
  for (const row of rows) {
    if (row.enabled === false) continue
    out[row.key] = row.value
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Merge what the transport reported with what the history detail resolved.
 * `detail` may be absent (history could not build one) — the dispatched values
 * are then returned on their own, exactly as before.
 */
export function sentRequest(dispatched: DispatchedRequest, detail: ResponseHistoryDetail | null | undefined): Record<string, unknown> {
  const side = (detail?.response ?? {}) as DetailRequestSide
  const resolvedHeaders = kvRecord(side.requestHeaders)
  const params = kvRecord(side.requestParams)
  const pathParams = kvRecord(side.requestPathParams)
  const body = capturedBody(side.requestBody)
  return {
    url: dispatched.url,
    method: dispatched.method,
    // Dispatched headers last: they are the ones that really left, including
    // any header the authentication step injected, which the request's own
    // resolved rows don't carry.
    headers: { ...resolvedHeaders, ...dispatched.headers },
    ...(params ? { params } : {}),
    ...(pathParams ? { pathParams } : {}),
    ...(body !== undefined ? { body } : {})
  }
}
