import React from 'react'
import { useIsRequestActive } from '../../hooks/useRequestActivity'
import { BeamWrap } from './BeamWrap'

export interface RequestExecutingBadgeProps {
  /** The request whose activity state drives the beam. */
  requestId: string
  /** The protocol / method badge to decorate. */
  children?: React.ReactNode
}

/**
 * Wraps a request's badge and runs the border-beam around it while the
 * request is ACTIVE — mid-execution (client in-flight) or listening (server
 * host / long-lived session). Every beam surface (send button, sidebar badge,
 * workbench tab badge) reads the same `useIsRequestActive` truth so the three
 * can never disagree, and the beam always finishes its current lap before
 * stopping (see BeamWrap).
 */
export const RequestExecutingBadge: React.FC<RequestExecutingBadgeProps> = ({ requestId, children }) => {
  const isActive = useIsRequestActive(requestId)
  return (
    <BeamWrap active={isActive} size={16} borderWidth={1.5}>
      {children}
    </BeamWrap>
  )
}
