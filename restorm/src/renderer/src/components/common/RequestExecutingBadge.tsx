import React from 'react'
import { useIsRequestExecuting } from '../../services/requestExecutingStore'
import { BeamWrap } from './BeamWrap'

export interface RequestExecutingBadgeProps {
  /** The request whose execution state drives the beam. */
  requestId: string
  /** The protocol / method badge to decorate. */
  children?: React.ReactNode
}

/**
 * Wraps a request's sidebar badge and runs the border-beam around it while the
 * request is executing — the same orbiting trail a running scenario / listening
 * Socket.IO request shows, so an in-flight request is visible in the sidebar
 * tree without opening its tab.
 */
export const RequestExecutingBadge: React.FC<RequestExecutingBadgeProps> = ({ requestId, children }) => {
  const executing = useIsRequestExecuting(requestId)
  return (
    <BeamWrap active={executing} size={16} borderWidth={1.5}>
      {children}
    </BeamWrap>
  )
}

export default RequestExecutingBadge
