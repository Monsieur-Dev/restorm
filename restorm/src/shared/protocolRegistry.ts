/**
 * The SINGLE source of truth for execution-protocol request TYPES — one
 * metadata record per protocol, keyed by the `type` discriminant. The
 * {@link RequestType} union itself is DERIVED from this object's keys, and
 * every per-type list the rest of the app needs (the GraphQL `RequestType`
 * enum, the `z.enum` validators, the request-class factory key set, the badge
 * map, the route builder) is derived from here rather than re-listed by hand —
 * so adding / removing / renaming a protocol type is a single edit here, and
 * any layer that forgets it fails the drift-guard test instead of silently
 * diverging.
 *
 * This registry is deliberately BOTH class-free AND executor-free / component-
 * free:
 *   - class-free, because the request model classes (`HTTPRequest`, …) import
 *     `RequestType` from `models/types`, which re-exports it from here — a class
 *     reference would close that import cycle. The runtime `type → Request`
 *     factory lives separately in `models/requests/requestFactory.ts`.
 *   - executor-free, because executors live in `src/main` (they import sockets /
 *     fs / gRPC) and would drag main code into the renderer bundle. The runtime
 *     executor map stays main-only (`main/protocol/executorRegistry.ts`).
 *   - component-free, because tab views / node boxes are renderer React and
 *     would drag the renderer bundle into main. Those live in the renderer-only
 *     `renderer/src/protocol/protocolUiRegistry.tsx`.
 * Guard tests cross-check that all three sibling registries cover exactly this
 * object's key set, so a type added here without an executor / UI entry fails
 * the build or the test rather than misbehaving at runtime.
 *
 * Authored with `satisfies Record<string, ProtocolSpec>` (NOT a type
 * annotation) so the object's KEYS stay the literal-union source the
 * `RequestType` type is inverted from.
 */

/** How a saved request's tree/tab badge label is chosen for a protocol.
 * `fixed` renders a constant capsule (e.g. GraphQL → `GQL`); `field` reads a
 * discriminating field off the request and maps its value (HTTP → `method`,
 * gRPC → `callType`, WebSocket → `protocol`). The concrete `BadgeType` mapping
 * lives in the renderer (`badgeUtils`); this stays a plain-string descriptor so
 * the registry carries no renderer types. */
export type ProtocolBadgeSpec =
  | { readonly kind: 'fixed'; readonly value: string }
  | { readonly kind: 'field'; readonly field: string }

/** Everything the shared / renderer / main layers need to know about a
 * protocol type that is NOT a class, an executor, or a React component. Each
 * optional flag carries a documented default so the registry states only a
 * protocol's exceptions. */
export interface ProtocolSpec {
  /** GraphQL union member name for this discriminant (`__resolveType`). */
  graphqlTypeName: string
  /** Workbench tab discriminant (`RestormEditorTab.tabType`). */
  tabType: string
  /** `window.restorm.<namespace>` IPC surface + the `<namespace>:*` main
   * channel prefix for this protocol. */
  ipcNamespace: string
  /** Tree/tab badge selection. */
  badge: ProtocolBadgeSpec
  /** The protocol can HOST a mock server (`request.server === true` renders the
   * SRV badge variant + a listen/stop lifecycle). Default false. */
  serverCapable?: boolean
  /** Custom search-result icon name; omit to fall back to the generic icon
   * (HTTP derives its icon from the method, so it omits this). Default: none. */
  searchIcon?: string
  /** Scenario node kinds this protocol contributes (documentation / palette
   * grouping only — the scenario node registry in `scenarioKindRegistry.ts`
   * remains the authoritative source for node behaviour). Default: none. */
  scenarioKinds?: readonly string[]
}

/**
 * The registry. KEY ORDER IS LOAD-BEARING: `REQUEST_TYPES` is derived in this
 * exact order and feeds the GraphQL enum + the `z.enum` validators, so entries
 * stay in the canonical protocol order.
 */
export const PROTOCOL_REGISTRY = {
  http: {
    graphqlTypeName: 'HTTPRequest',
    tabType: 'http-request',
    ipcNamespace: 'http',
    badge: { kind: 'field', field: 'method' },
    serverCapable: true,
    scenarioKinds: ['httpRequest', 'httpListen', 'httpClose']
  },
  graphql: {
    graphqlTypeName: 'GraphQLRequest',
    tabType: 'graphql-request',
    ipcNamespace: 'graphql',
    badge: { kind: 'fixed', value: 'GQL' },
    serverCapable: true,
    searchIcon: 'graphql',
    scenarioKinds: ['graphqlListen', 'graphqlClose', 'graphqlSubscribe', 'graphqlUnsubscribe']
  },
  grpc: {
    graphqlTypeName: 'GrpcRequest',
    tabType: 'grpc-request',
    ipcNamespace: 'grpc',
    badge: { kind: 'field', field: 'callType' },
    serverCapable: true,
    searchIcon: 'grpc',
    scenarioKinds: ['grpcConnect', 'grpcSend', 'grpcClose', 'grpcListen', 'grpcServerClose']
  },
  soap: {
    graphqlTypeName: 'SoapRequest',
    tabType: 'soap-request',
    ipcNamespace: 'soap',
    badge: { kind: 'fixed', value: 'SOAP' },
    serverCapable: true,
    searchIcon: 'soap',
    scenarioKinds: ['soapRequest', 'soapListen', 'soapClose']
  },
  websocket: {
    graphqlTypeName: 'WebSocketRequest',
    tabType: 'websocket-request',
    ipcNamespace: 'websocket',
    badge: { kind: 'field', field: 'protocol' },
    serverCapable: true,
    searchIcon: 'websocket',
    scenarioKinds: [
      'websocketConnect', 'websocketSend', 'websocketClose',
      'socketioConnect', 'socketioSend', 'socketioClose',
      'mqttConnect', 'mqttSend', 'mqttClose'
    ]
  },
  odata: {
    graphqlTypeName: 'ODataRequest',
    tabType: 'odata-request',
    ipcNamespace: 'odata',
    badge: { kind: 'fixed', value: 'ODATA' },
    serverCapable: true,
    scenarioKinds: ['odataListen', 'odataClose']
  },
  auth: {
    graphqlTypeName: 'AuthenticationRequest',
    tabType: 'auth-request',
    ipcNamespace: 'auth',
    badge: { kind: 'fixed', value: 'AUTH' }
  },
  jsonrpc: {
    graphqlTypeName: 'JsonRpcRequest',
    tabType: 'jsonrpc-request',
    ipcNamespace: 'jsonrpc',
    badge: { kind: 'fixed', value: 'RPC' }
  },
  // Note: the discriminant is camelCase (not `jsonrpc-batch`) because
  // `RequestType` feeds `graphQLSchemaGenerator.registerEnum('RequestType', …)`
  // verbatim as GraphQL enum member names — a hyphen there produces invalid
  // SDL. The user-facing / doc / file-naming spelling stays "JSON-RPC batch".
  jsonrpcBatch: {
    graphqlTypeName: 'JsonRpcBatchRequest',
    tabType: 'jsonrpc-batch-request',
    ipcNamespace: 'jsonrpc',
    badge: { kind: 'fixed', value: 'RPC[]' }
  }
} satisfies Record<string, ProtocolSpec>

/** The request `type` discriminant union — inverted from the registry keys so a
 * new protocol only edits {@link PROTOCOL_REGISTRY}. */
export type RequestType = keyof typeof PROTOCOL_REGISTRY

/** All request-type discriminants, in canonical order. Typed as a non-empty
 * tuple so it drops straight into `z.enum(...)` and the GraphQL enum
 * registration. */
export const REQUEST_TYPES = Object.keys(PROTOCOL_REGISTRY) as [RequestType, ...RequestType[]]

/** Look up a protocol's metadata by discriminant. */
export function protocolSpec(type: RequestType): ProtocolSpec {
  return PROTOCOL_REGISTRY[type]
}

/** GraphQL union member name for a request `type` discriminant, or `null` for an
 * unknown discriminant (so the caller can throw with context rather than
 * silently resolving to the wrong protocol type). */
export function graphqlTypeNameForRequestType(type: unknown): string | null {
  return typeof type === 'string' && type in PROTOCOL_REGISTRY
    ? PROTOCOL_REGISTRY[type as RequestType].graphqlTypeName
    : null
}
