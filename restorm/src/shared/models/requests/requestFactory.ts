import type { RequestType } from '../../protocolRegistry'
import type { Request } from '../../types/requests'
import { HTTPRequest } from './HTTPRequest'
import { GraphQLRequest } from './GraphQLRequest'
import { GrpcRequest } from './GrpcRequest'
import { SoapRequest } from './SoapRequest'
import { WebSocketRequest } from './WebSocketRequest'
import { ODataRequest } from './ODataRequest'
import { AuthenticationRequest } from './AuthenticationRequest'

/**
 * The runtime `type → Request class` factory — the class-bearing sibling of the
 * class-free {@link PROTOCOL_REGISTRY}. Kept SEPARATE from the metadata registry
 * on purpose: the request classes import `RequestType` (via `models/types`),
 * which re-exports it from `protocolRegistry`, so referencing the classes from
 * that metadata module would close an import cycle. The union stays derived
 * from the metadata registry; this map is a plain lookup guarded by a drift
 * test against the same key set.
 *
 * Each entry carries the class's `fromPlain` deserializer (persistence /
 * collection reify path) and the constructor (create path). A new protocol
 * appends ONE entry here — no `switch` to touch.
 */
type PlainRequest = Partial<Request> & { type: RequestType }

interface RequestClassEntry {
  /** Deserialize a persisted plain object into the concrete Request instance. */
  fromPlain(data: PlainRequest): Request
  /** The concrete Request constructor (used by the create path). */
  ctor: new (...args: unknown[]) => Request
}

// The per-class `fromPlain` param types differ, so each entry casts the shared
// `PlainRequest` to that class's parameter shape at the boundary — mirrors the
// casts the previous hand-written switch performed.
export const REQUEST_CLASS_REGISTRY: Record<RequestType, RequestClassEntry> = {
  http: { fromPlain: (d) => HTTPRequest.fromPlain(d as Parameters<typeof HTTPRequest.fromPlain>[0]), ctor: HTTPRequest as unknown as new (...args: unknown[]) => Request },
  graphql: { fromPlain: (d) => GraphQLRequest.fromPlain(d as Parameters<typeof GraphQLRequest.fromPlain>[0]), ctor: GraphQLRequest as unknown as new (...args: unknown[]) => Request },
  grpc: { fromPlain: (d) => GrpcRequest.fromPlain(d as Parameters<typeof GrpcRequest.fromPlain>[0]), ctor: GrpcRequest as unknown as new (...args: unknown[]) => Request },
  soap: { fromPlain: (d) => SoapRequest.fromPlain(d as Parameters<typeof SoapRequest.fromPlain>[0]), ctor: SoapRequest as unknown as new (...args: unknown[]) => Request },
  websocket: { fromPlain: (d) => WebSocketRequest.fromPlain(d as Parameters<typeof WebSocketRequest.fromPlain>[0]), ctor: WebSocketRequest as unknown as new (...args: unknown[]) => Request },
  odata: { fromPlain: (d) => ODataRequest.fromPlain(d as Parameters<typeof ODataRequest.fromPlain>[0]), ctor: ODataRequest as unknown as new (...args: unknown[]) => Request },
  auth: { fromPlain: (d) => AuthenticationRequest.fromPlain(d as Parameters<typeof AuthenticationRequest.fromPlain>[0]), ctor: AuthenticationRequest as unknown as new (...args: unknown[]) => Request }
}

/**
 * Deserialize a persisted plain request into its concrete Request instance.
 * Falls back to HTTPRequest for an unknown discriminant, preserving the prior
 * behaviour of the collection-reify path.
 */
export function createRequestFromPlain(data: PlainRequest): Request {
  // `data.type` originates from untrusted persisted JSON (cast to RequestType at
  // the reify boundary), so an unknown discriminant is possible at runtime; fall
  // back to HTTPRequest, matching the pre-registry reify behaviour.
  const entry = REQUEST_CLASS_REGISTRY[data.type] as RequestClassEntry | undefined
  return (entry ?? REQUEST_CLASS_REGISTRY.http).fromPlain(data)
}

/**
 * The concrete Request constructor for a discriminant. `type` comes from a live
 * in-memory Request, so it is always a valid registry key.
 */
export function getRequestConstructor(type: RequestType): new (...args: unknown[]) => Request {
  return REQUEST_CLASS_REGISTRY[type].ctor
}
