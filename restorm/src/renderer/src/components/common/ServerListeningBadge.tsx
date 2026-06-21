import React from 'react'
import { useIsWebsocketListening } from '../../services/websocketListeningStore'
import { useIsGrpcListening } from '../../services/grpcListeningStore'
import { useIsHttpListening } from '../../services/httpListeningStore'
import { BeamWrap } from './BeamWrap'

export interface ServerListeningBadgeProps {
  /** The request whose listening state drives the beam. */
  requestId: string
  /** The protocol badge to decorate (e.g. the `SRV` capsule glyph). */
  children?: React.ReactNode
}

/**
 * Wraps a long-running / server request badge and runs the border-beam around it
 * while the request is listening — an HTTP mock host, a raw-WS / Socket.IO / MQTT
 * server, or an open gRPC stream. The same orbiting trail a running scenario
 * shows, so an active listener is visible BOTH in the sidebar tree AND on the
 * workbench tab without opening the request.
 *
 * A `requestId` belongs to exactly one protocol, so ORing every protocol's
 * listening store is safe — at most one is ever `true` for a given id — and
 * keeps a single badge generic across HTTP/WS/SIO/MQTT/gRPC.
 */
export const ServerListeningBadge: React.FC<ServerListeningBadgeProps> = ({ requestId, children }) => {
  const wsListening = useIsWebsocketListening(requestId)
  const grpcListening = useIsGrpcListening(requestId)
  const httpListening = useIsHttpListening(requestId)
  return (
    <BeamWrap active={wsListening || grpcListening || httpListening} size={16} borderWidth={1.5}>
      {children}
    </BeamWrap>
  )
}

export default ServerListeningBadge
