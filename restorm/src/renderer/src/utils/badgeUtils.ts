import type { BadgeType } from '../components/common/Badge'
import type { Request } from '../../../shared/types/requests'
import { protocolSpec } from '../../../shared/protocolRegistry'

/**
 * Badge for a saved request, by protocol — driven by the protocol registry's
 * badge spec: a `fixed` capsule (GraphQL → `GQL`, SOAP → `SOAP`, …) or a value
 * read from a discriminating `field` (HTTP → `method`, gRPC → `callType`,
 * WebSocket → `protocol`) and mapped through {@link mapToBadgeType}.
 */
export function requestBadgeType(request: Request): BadgeType {
  const badge = protocolSpec(request.type).badge
  if (badge.kind === 'fixed') return badge.value as BadgeType
  const raw = (request as unknown as Record<string, unknown>)[badge.field]
  return typeof raw === 'string' ? mapToBadgeType(raw) : 'GET'
}

/**
 * Badge `mode` for a saved request: `server` when restorm HOSTS the protocol
 * (a WebSocket/Socket.IO/MQTT server, an HTTP mock server, a gRPC mock server,
 * a SOAP / GraphQL mock server, or an OData mock service), otherwise `client`. Any
 * server-capable request whose `server` flag is set renders the uniform SRV
 * capsule variant of its protocol badge — pair with {@link requestBadgeType}.
 */
export function requestBadgeMode(request: Request): 'client' | 'server' {
  return protocolSpec(request.type).serverCapable === true
    && (request as { server?: boolean }).server === true
    ? 'server'
    : 'client'
}

/**
 * Codicon glyph for a Kafka request mode. Kafka is the one protocol whose
 * produce / consume / browse variants share a single fixed badge label
 * (`KAFKA`), so a discriminating glyph rides on the badge to tell them apart.
 * Shared by the Add menu, the sidebar tree and the workbench tab so all three
 * render the SAME glyph for a given mode.
 */
export function kafkaModeIcon(mode: string | undefined): string {
  switch (mode) {
    case 'consume': return 'plug'
    case 'browse': return 'eye'
    case 'produce':
    default: return 'arrow-up'
  }
}

/**
 * Optional sub-type glyph for a saved request's badge, or `undefined` when the
 * protocol's badge label already distinguishes its sub-types (HTTP methods,
 * gRPC call types, GraphQL op types are the label itself). Only Kafka needs one
 * today — its modes collapse onto the fixed `KAFKA` label — so the badge picks
 * up the same produce/consume/browse codicon the Add menu shows.
 */
export function requestBadgeIcon(request: Request): string | undefined {
  if (request.type === 'kafka') {
    return kafkaModeIcon((request as { mode?: string }).mode)
  }
  return undefined
}

/** Base badge-registry id per `BadgeType`. `badgeRegistry.json` is the single
 * styling source; this table maps the legacy `type` discriminant onto its base
 * id. Unknown types (a custom HTTP verb) fall through to `http_other`. */
const TYPE_TO_BASE: Partial<Record<BadgeType, string>> = {
  GET: 'http_get', POST: 'http_post', PUT: 'http_put', DELETE: 'http_delete',
  PATCH: 'http_patch', HEAD: 'http_head', OPTIONS: 'http_options',
  UNARY: 'grpc_unary', 'S-STR': 'grpc_sstr', 'C-STR': 'grpc_cstr', BIDI: 'grpc_bidi',
  GRPC: 'grpc',
  GQL: 'gql', QUERY: 'gql_query', MUTATION: 'gql_mutation', SUBSCRIPTION: 'gql_subscription',
  SOAP: 'soap',
  WS: 'ws', MQTT: 'mqtt', SIO: 'sio', STOMP: 'stomp',
  SSE: 'sse', KAFKA: 'kafka', ODATA: 'odata', tRPC: 'trpc',
  RPC: 'rpc', 'RPC[]': 'rpc_batch',
  REDIS: 'redis', AUTH: 'auth', AMQP: 'amqp', SCENARIO: 'scenario', DESIGN: 'design', PRO: 'pro'
}

/** Generic action suffix per codicon (send / connect / close). Kafka and the
 * GraphQL subscription node override this — their glyphs mean
 * produce/consume/browse and subscribe/unsubscribe. */
const GENERIC_ICON_SUFFIX: Record<string, string> = {
  'arrow-up': 'send', plug: 'connect', 'debug-disconnect': 'close'
}

/** Per-base codicon → full registry id, where the generic suffix scheme doesn't
 * fit (Kafka modes, GraphQL subscribe/unsubscribe). */
const ICON_ID_OVERRIDE: Record<string, Record<string, string>> = {
  kafka: { 'arrow-up': 'kafka_produce', plug: 'kafka_consume', eye: 'kafka_browse', 'debug-disconnect': 'kafka_close' },
  gql_query: { broadcast: 'gql_subscribe', 'debug-disconnect': 'gql_unsubscribe' }
}

/** Base → dedicated server-capsule id, where it isn't simply `${base}_server`.
 * The workbench GraphQL tab (`GQL`) and the scenario GraphQL server node
 * (`QUERY`) deliberately keep different labels today, so their server capsules
 * resolve to distinct ids. */
const SERVER_ID_OVERRIDE: Record<string, string> = { gql_query: 'gql_query_server' }

/** Whether `type` has a dedicated registry base (vs a custom HTTP verb). */
export function isKnownBadgeType(type: BadgeType): boolean {
  return TYPE_TO_BASE[type] !== undefined
}

/**
 * Resolve the legacy `(type, mode, icon)` triple onto a `badgeRegistry.json` id
 * (+ whether the caller-driven `server` capsule prop is needed for HTTP mock
 * servers, whose body stays method-colored so they have no fixed server entry).
 * This is the single mapping the {@link mapToBadgeType}-era call sites share
 * with the direct-id surfaces.
 */
export function resolveBadgeId(
  type: BadgeType,
  mode: 'client' | 'server' | undefined,
  icon: string | undefined
): { badgeId: string; server?: boolean } {
  const base = TYPE_TO_BASE[type] ?? 'http_other'
  if (mode === 'server') {
    if (base.startsWith('http_')) return { badgeId: base, server: true }
    return { badgeId: SERVER_ID_OVERRIDE[base] ?? `${base}_server` }
  }
  if (icon !== undefined) {
    const override = ICON_ID_OVERRIDE[base]?.[icon]
    if (override !== undefined) return { badgeId: override }
    const suffix = GENERIC_ICON_SUFFIX[icon]
    if (suffix !== undefined) return { badgeId: `${base}_${suffix}` }
  }
  return { badgeId: base }
}

/**
 * Badge-registry id for a saved request — the direct-id equivalent of the
 * {@link requestBadgeType} + {@link requestBadgeMode} + {@link requestBadgeIcon}
 * triple. Used by the sidebar / favorites / open-items rows to render their
 * badge straight from the registry.
 */
export function requestBadgeId(request: Request): string {
  return resolveBadgeId(requestBadgeType(request), requestBadgeMode(request), requestBadgeIcon(request)).badgeId
}

/**
 * Map raw protocol/type values to BadgeType
 */
export function mapToBadgeType(value: string): BadgeType {
  const normalized = value.toLowerCase()
  
  // HTTP Methods
  if (['get', 'post', 'put', 'delete', 'patch', 'head', 'options'].includes(normalized)) {
    return normalized.toUpperCase() as BadgeType
  }
  
  // gRPC call types
  switch (normalized) {
    case 'unary': return 'UNARY'
    case 'server-stream':
    case 'server_stream':
    case 'server-streaming': return 'S-STR'
    case 'client-stream':
    case 'client_stream':
    case 'client-streaming': return 'C-STR'
    case 'bidirectional-stream':
    case 'bidirectional_stream':
    case 'bidirectional':
    case 'bidi': return 'BIDI'
  }
  
  // GraphQL operation types
  switch (normalized) {
    case 'query': return 'QUERY'
    case 'mutation': return 'MUTATION'
    case 'subscription': return 'SUBSCRIPTION'
    case 'graphql':
    case 'gql': return 'GQL'
  }
  
  // SOAP
  if (normalized === 'soap') return 'SOAP'
  
  // WebSocket protocols
  switch (normalized) {
    case 'websocket':
    case 'ws': return 'WS'
    case 'socketio':
    case 'socket.io':
    case 'sio': return 'SIO'
    case 'mqtt': return 'MQTT'
  }

  // OData
  if (normalized === 'odata') return 'ODATA'

  // Authentication
  if (normalized === 'auth') return 'AUTH'

  // AMQP (RabbitMQ)
  if (normalized === 'amqp') return 'AMQP'

  // Scenario (dataflow graph)
  if (normalized === 'scenario') return 'SCENARIO'

  // API design
  if (normalized === 'design') return 'DESIGN'

  // Fallback: try to use value as-is if it's a valid BadgeType
  return value.toUpperCase() as BadgeType
}
