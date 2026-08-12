import React, { useCallback, useEffect, useReducer, useRef } from 'react'
import { BorderBeam } from 'electron-core-ui/renderer'
import { useIsScenarioRunning } from '../../services/scenarioRunningStore'
import { prefersReducedMotion } from '../../utils/prefersReducedMotion'
import './ScenarioRunningBadge.css'

const BEAM_LAP_S = 1.5

export interface ScenarioRunningBadgeProps {
  /** The scenario whose live-run state drives the beam. */
  scenarioId: string
  /** The badge to decorate (the `SCENARIO` circuit-board glyph). */
  children?: React.ReactNode
}

/**
 * Wraps a scenario badge and runs a small border-beam around it while the
 * scenario has an in-flight run — the same orbiting trail the graph paints on
 * a running node box, scaled down to the badge. Used everywhere a scenario
 * badge shows (sidebar tree, workbench tab strip, favorites / open-items),
 * so the user can spot a running scenario without opening its editor.
 */
export const ScenarioRunningBadge: React.FC<ScenarioRunningBadgeProps> = ({ scenarioId, children }) => {
  const running = useIsScenarioRunning(scenarioId)
  // Mirror the running node box: the beam mounts while the scenario runs, but
  // when the run ends it doesn't vanish mid-lap — it finishes the trail it
  // started and only then unmounts (on the next animation iteration after a
  // stop is requested). `useReducer` (not `useState`) sidesteps the React
  // Compiler's set-state-in-effect rule for this prop-driven transition.
  const [beamOn, dispatchBeam] = useReducer((_state: boolean, on: boolean) => on, false)
  const wantsStopRef = useRef(false)
  useEffect(() => {
    if (running) {
      dispatchBeam(true)
      wantsStopRef.current = false
      return
    }
    // Don't drop the beam now — mark it for removal on the next lap boundary.
    wantsStopRef.current = true
    // …unless there is no lap to wait for: under reduced motion the trail
    // carries `animation: none`, so `animationiteration` never fires and the
    // overlay would stay on the badge for good. Gated on `beamOn` so an idle
    // badge never dispatches.
    if (beamOn && prefersReducedMotion()) {
      dispatchBeam(false)
      wantsStopRef.current = false
    }
  }, [running, beamOn])
  const onAnimationIteration = useCallback((e: React.AnimationEvent<HTMLSpanElement>): void => {
    if (e.animationName === 'ecu-border-beam-travel' && wantsStopRef.current) {
      dispatchBeam(false)
      wantsStopRef.current = false
    }
  }, [])
  return (
    <span className="scn-running-badge" onAnimationIteration={onAnimationIteration}>
      {children}
      {beamOn && (
        <BorderBeam
          size={16}
          duration={BEAM_LAP_S}
          borderWidth={1.5}
          colorFrom="#facc15"
          colorTo="#22c55e"
        />
      )}
    </span>
  )
}
