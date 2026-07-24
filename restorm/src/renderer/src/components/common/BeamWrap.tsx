import React, { useCallback, useEffect, useReducer, useRef } from 'react'
import { BorderBeam } from 'electron-core-ui/renderer'
import './ScenarioRunningBadge.css'

const BEAM_LAP_S = 1.5

export interface BeamWrapProps {
  /** Whether the orbiting beam should be running. */
  active: boolean
  /** Trail length in px (16 ≈ badge, 80 ≈ a node box). */
  size?: number
  borderWidth?: number
  /** Extra class on the wrapper span (it is `position: relative; inline-flex`). */
  className?: string
  /** Leading colour of the trail gradient. */
  colorFrom?: string
  /** Trailing colour of the trail gradient. */
  colorTo?: string
  children?: React.ReactNode
}

/**
 * Generic border-beam overlay: runs the same yellow→green orbiting trail the
 * scenario graph paints on a running node, around whatever it wraps, while
 * `active` is true. When `active` flips false the beam finishes its current lap
 * before unmounting (no mid-lap jump) — the same graceful stop as
 * {@link ScenarioRunningBadge}.
 */
export const BeamWrap: React.FC<BeamWrapProps> = ({ active, size = 16, borderWidth = 1.5, className, colorFrom = '#facc15', colorTo = '#22c55e', children }) => {
  const [beamOn, dispatchBeam] = useReducer((_state: boolean, on: boolean) => on, false)
  const wantsStopRef = useRef(false)
  useEffect(() => {
    if (active) {
      dispatchBeam(true)
      wantsStopRef.current = false
    } else {
      wantsStopRef.current = true
    }
  }, [active])
  const onAnimationIteration = useCallback((e: React.AnimationEvent<HTMLSpanElement>): void => {
    if (e.animationName === 'ecu-border-beam-travel' && wantsStopRef.current) {
      dispatchBeam(false)
      wantsStopRef.current = false
    }
  }, [])
  return (
    <span className={`scn-running-badge${className ? ` ${className}` : ''}`} onAnimationIteration={onAnimationIteration}>
      {children}
      {beamOn && (
        <BorderBeam size={size} duration={BEAM_LAP_S} borderWidth={borderWidth} colorFrom={colorFrom} colorTo={colorTo} />
      )}
    </span>
  )
}

export default BeamWrap
