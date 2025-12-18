import React from 'react'

export type ProtocolType = 
  | 'graphql' | 'query' | 'mutation' | 'subscription'
  | 'grpc' | 'unary' | 'server-stream' | 'client-stream' | 'bidirectional-stream'
  | 'soap'
  | 'websocket' | 'ws' | 'socketio' | 'sio' | 'mqtt'
  | 'publish' | 'pub' | 'subscribe' | 'sub'

interface ProtocolBadgeProps {
  /** The protocol or operation type */
  protocol: string
  /** Optional label override (defaults to protocol) */
  label?: string | undefined
}

const LABEL_MAP: Record<string, string> = {
  'graphql': 'GQL',
  'query': 'QRY',
  'mutation': 'MUT',
  'subscription': 'SUB',
  'grpc': 'gRPC',
  'unary': 'UNARY',
  'server-stream': 'S-STR',
  'client-stream': 'C-STR',
  'bidirectional-stream': 'BI-STR',
  'soap': 'SOAP',
  'websocket': 'WS',
  'ws': 'WS',
  'socketio': 'SIO',
  'sio': 'SIO',
  'mqtt': 'MQTT',
  'publish': 'PUB',
  'pub': 'PUB',
  'subscribe': 'SUB',
  'sub': 'SUB'
}

export const ProtocolBadge: React.FC<ProtocolBadgeProps> = ({ protocol, label }) => {
  const normalized = protocol.toLowerCase()
  const className = `protocol-badge protocol-badge--${normalized}`
  const displayLabel = label ?? LABEL_MAP[normalized] ?? protocol.toUpperCase()

  return <span className={className}>{displayLabel}</span>
}
