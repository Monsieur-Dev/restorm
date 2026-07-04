import type { BaseRequest } from './BaseRequest'
import type { KeyValue } from '../baseTypes'
import type { TrpcCallKind } from '../requestPrimitives'

export interface TrpcRequest extends BaseRequest {
  type: 'trpc'
  /** Base server URL — the tRPC procedure path is appended to this by the
   * execution layer (`<url>/<procedure>`). */
  url: string
  /** Dot-separated procedure path, e.g. `user.get`, `post.create`. */
  procedure: string
  /** JSON object passed as the procedure's `input`, Handlebars-templated. */
  input?: string
  /** query → GET with `?input=`; mutation → POST with the v10 body envelope. */
  kind: TrpcCallKind
  headers: KeyValue[]
}
