import React from 'react'
import { BorderBeam } from 'electron-core-ui/renderer'
import { useIsScenarioRunning } from '../../services/scenarioRunningStore'
import './ScenarioRunningBadge.css'

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
  return (
    <span className="scn-running-badge">
      {children}
      {running && (
        <BorderBeam
          size={16}
          duration={1.5}
          borderWidth={1.5}
          colorFrom="#facc15"
          colorTo="#22c55e"
        />
      )}
    </span>
  )
}

export default ScenarioRunningBadge
