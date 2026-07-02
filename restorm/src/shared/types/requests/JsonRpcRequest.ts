import type { BaseRequest } from './BaseRequest'
import type { KeyValue } from '../baseTypes'

/**
 * A single JSON-RPC 2.0 call, persisted as a `jsonrpc` request. The wire
 * envelope (`{ jsonrpc: '2.0', method, params, id }`) is composed by
 * `JsonRpcExecutionService` from these fields at dispatch time — every
 * field is env-/Handlebars-templated before it reaches the wire.
 */
export interface JsonRpcRequest extends BaseRequest {
  type: 'jsonrpc'
  /** Endpoint URL the envelope is POSTed to. */
  url: string
  /** Extra request headers forwarded to the underlying HTTP POST
   * (`Content-Type: application/json` is added automatically). */
  headers: KeyValue[]
  /** RPC method name. */
  method: string
  /** Raw JSON source for `params` — either a `[...]` array (positional)
   * or a `{...}` object (named). Persisted as a string so a single
   * Monaco/Handlebars editor can accept either shape; parsed and
   * validated at execution time. */
  params: string
  /** JSON-RPC request id (distinct from {@link BaseRequest.id}, the
   * request's own persisted identity). Empty string ⇒ auto-generated
   * at execution time. Ignored (omitted from the envelope) when
   * `notificationMode` is on. */
  rpcId: string
  /** When true, the envelope carries no `id` and the response panel
   * reports "Notification sent" instead of unwrapping a `result` /
   * `error` — per the JSON-RPC 2.0 spec, a notification expects no
   * response body. */
  notificationMode?: boolean
}

/** One child call inside a `jsonrpc-batch` request. `childId` is a
 * stable UI row id (list keys / reordering), distinct from `rpcId`
 * (the actual JSON-RPC `id` sent on the wire). */
export interface JsonRpcBatchCallSpec {
  childId: string
  method: string
  params: string
  /** JSON-RPC request id for this call. Empty ⇒ auto-generated. */
  rpcId: string
  notificationMode?: boolean
}

/** A JSON-RPC 2.0 batch — the spec's array-of-envelopes form, POSTed as
 * a single JSON array in one HTTP call. Response children are matched
 * back to their originating call by `rpcId`.
 *
 * The discriminant is `jsonrpcBatch` (camelCase), not `jsonrpc-batch`: it
 * feeds `PROTOCOL_REGISTRY` → `REQUEST_TYPES`, which is registered verbatim
 * as GraphQL `RequestType` enum member names — a hyphen there is invalid
 * SDL. User-facing text / file names still say "JSON-RPC batch". */
export interface JsonRpcBatchRequest extends BaseRequest {
  type: 'jsonrpcBatch'
  url: string
  headers: KeyValue[]
  children: JsonRpcBatchCallSpec[]
}
