import type { BadgeType } from '../components/common/Badge'

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

  // Fallback: try to use value as-is if it's a valid BadgeType
  return value.toUpperCase() as BadgeType
}
