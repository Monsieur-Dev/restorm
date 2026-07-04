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

  // Fallback: try to use value as-is if it's a valid BadgeType
  return value.toUpperCase() as BadgeType
}
