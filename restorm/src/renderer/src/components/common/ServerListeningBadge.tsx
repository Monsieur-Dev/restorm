import React from 'react'
import { useIsRequestActive } from '../../hooks/useRequestActivity'
import { BeamWrap } from './BeamWrap'

export interface ServerListeningBadgeProps {
  /** The request whose activity state drives the beam. */
  requestId: string
  /** The protocol badge to decorate (e.g. the `SRV` capsule glyph). */
  children?: React.ReactNode
}

/**
 * Alias of `RequestExecutingBadge` kept so server call-sites stay legible:
 * both decorate the badge with the border-beam while the request is ACTIVE
 * (mid-execution OR listening), reading the single `useIsRequestActive`
 * truth. A server's beam persists exactly as long as its listening store
 * says the host is up, and only stops when the server is stopped.
 */
export const ServerListeningBadge: React.FC<ServerListeningBadgeProps> = ({ requestId, children }) => {
  const isActive = useIsRequestActive(requestId)
  return (
    <BeamWrap active={isActive} size={16} borderWidth={1.5}>
      {children}
    </BeamWrap>
  )
}

export default ServerListeningBadge
