import React from 'react'
import { useIsWebsocketListening } from '../../services/websocketListeningStore'
import { BeamWrap } from './BeamWrap'

export interface WebsocketListeningBadgeProps {
  /** The request whose open-connection state drives the beam. */
  requestId: string
  /** The protocol badge to decorate (e.g. the `SIO` glyph). */
  children?: React.ReactNode
}

/**
 * Wraps a WebSocket/Socket.IO request badge and runs the border-beam around it
 * while the request holds an open connection (is listening) — the same orbiting
 * trail a running scenario shows, so an active listener is visible in the
 * sidebar tree without opening its tab.
 */
export const WebsocketListeningBadge: React.FC<WebsocketListeningBadgeProps> = ({ requestId, children }) => {
  const listening = useIsWebsocketListening(requestId)
  return (
    <BeamWrap active={listening} size={16} borderWidth={1.5}>
      {children}
    </BeamWrap>
  )
}

export default WebsocketListeningBadge
