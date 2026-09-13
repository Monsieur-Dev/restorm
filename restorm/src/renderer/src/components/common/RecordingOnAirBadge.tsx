import React from 'react'
import { BorderBeam } from 'electron-core-ui/renderer'
import { useRecordingStatus } from '../../services/recordingStatusStore'
import './RecordingOnAirBadge.css'

const BEAM_LAP_S = 1.5

export interface RecordingOnAirBadgeProps {
  sessionId: string
  children?: React.ReactNode
}

/**
 * Hosts a recording session's badge and its "on air" border-beam: the beam
 * orbits the badge while the session records, and FREEZES in place (the
 * animation is paused, not removed) while the recording is paused — the
 * same treatment the workbench tab gets.
 */
export const RecordingOnAirBadge: React.FC<RecordingOnAirBadgeProps> = ({ sessionId, children }) => {
  const status = useRecordingStatus(sessionId)
  const onAir = status.state !== 'idle'
  const paused = status.state === 'paused'
  return (
    <span
      className={`recording-on-air-badge${paused ? ' recording-on-air-badge--paused' : ''}`}
      data-testid={`recording-on-air-${sessionId}`}
      data-recording-state={status.state}
    >
      {children}
      {onAir && (
        <BorderBeam
          size={16}
          duration={BEAM_LAP_S}
          borderWidth={1.5}
          colorFrom="var(--recording-on-air-background)"
          colorTo="var(--recording-on-air-beam-tail)"
        />
      )}
    </span>
  )
}
