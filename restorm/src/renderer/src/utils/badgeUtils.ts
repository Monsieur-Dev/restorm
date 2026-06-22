import type { BadgeType } from '../components/common/Badge'
import type { Request } from '../../../shared/types/requests'

/**
 * Badge for a saved request, by protocol — mirrors the per-protocol choice
 * the workbench tab title makes (method for HTTP/auth, call type for gRPC,
 * sub-protocol for WebSocket, fixed badge for GraphQL/SOAP/OData).
 */
export function requestBadgeType(request: Request): BadgeType {
  switch (request.type) {
    case 'http': return mapToBadgeType(request.method)
    case 'auth': return 'AUTH'
    case 'graphql': return 'GQL'
    case 'grpc': return mapToBadgeType(request.callType)
    case 'soap': return 'SOAP'
    case 'websocket': return mapToBadgeType(request.protocol)
    case 'odata': return 'ODATA'
    default: return 'GET'
  }
}

/**
 * Badge `mode` for a saved request: `server` when restorm HOSTS the protocol
 * (a WebSocket/Socket.IO/MQTT server, an HTTP mock server, a gRPC mock server,
 * or a SOAP mock server), otherwise `client`. Any request whose `server` flag is set renders
 * the uniform SRV capsule variant of its protocol badge — pair with
 * {@link requestBadgeType}.
 */
export function requestBadgeMode(request: Request): 'client' | 'server' {
  return (request.type === 'websocket' || request.type === 'http' || request.type === 'grpc' || request.type === 'soap' || request.type === 'graphql')
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

  // Scenario (dataflow graph)
  if (normalized === 'scenario') return 'SCENARIO'

  // Fallback: try to use value as-is if it's a valid BadgeType
  return value.toUpperCase() as BadgeType
}
