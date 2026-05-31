import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollableElement } from 'electron-core-ui/renderer'
import type { Scenario } from '../../../../shared/types/collections'
import type { ScenarioRunSnapshot } from '../../../../shared/types/scenarioRunHistory'
import { ScenarioGraphPreview } from '../MainView/Titlebar/ScenarioGraphPreview'
import './scenarioRunGraphTab.css'

export interface ScenarioRunGraphTabProps {
  /** The scenarios captured at run time — index 0 is the main scenario,
   * the rest are the referenced sub-scenarios. */
  scenarios: readonly ScenarioRunSnapshot[]
  /** A focus request from a run-log click: select the emitting scenario and
   * pan/zoom + flash its node. `token` retriggers even for the same target. */
  focusRequest?: { scenarioId: string; nodeId: string; token: number } | null
  /** Identity of the run being shown — switching runs resets the selection +
   * any active focus (the snapshots can be identical, so a prop-diff isn't
   * enough to tell). */
  runKey?: string | null
}

/**
 * Read-only view of the scenarios as they were AT RUN TIME. A horizontal
 * master strip of 200×200 fit-to-view thumbnails (main first, no
 * pan/zoom) over a detail pane showing the selected scenario read-only
 * WITH pan/zoom. The selected thumbnail carries a border.
 */
export const ScenarioRunGraphTab: React.FC<ScenarioRunGraphTabProps> = ({ scenarios, focusRequest, runKey }) => {
  const { t } = useTranslation()
  const [selected, setSelected] = useState(0)
  // The node to pan/zoom + flash in the detail pane. Paired with `selected`:
  // set together on a focus request, cleared when the user picks a thumbnail.
  const [focusNode, setFocusNode] = useState<{ nodeId: string; token: number } | null>(null)
  const [appliedReqToken, setAppliedReqToken] = useState(-1)
  const [seenRunKey, setSeenRunKey] = useState<string | null | undefined>(runKey)

  // Switching runs resets the selection + clears any active focus.
  if (runKey !== seenRunKey) {
    setSeenRunKey(runKey)
    setSelected(0)
    setFocusNode(null)
  }

  // Apply a fresh focus request (compare-and-set in render, state-guarded so it
  // can't loop): select the emitting scenario + flash its node.
  if (focusRequest && focusRequest.token !== appliedReqToken) {
    setAppliedReqToken(focusRequest.token)
    const idx = scenarios.findIndex((s) => s.id === focusRequest.scenarioId)
    if (idx >= 0) setSelected(idx)
    setFocusNode({ nodeId: focusRequest.nodeId, token: focusRequest.token })
  }

  if (scenarios.length === 0) {
    return <div className="scn-graph-empty">{t('scenario.runHistory.noGraph', 'No scenario snapshot for this run')}</div>
  }

  const selectedIndex = Math.min(selected, scenarios.length - 1)
  const current = scenarios[selectedIndex]

  return (
    <div className="scn-graph-tab">
      {/* The thumbnail strip only earns its space when there's a CHOICE — a
        * lone scenario (no sub-scenarios) goes straight to the detail. */}
      {scenarios.length > 1 && (
        <ScrollableElement className="scn-graph-master" options={{ horizontal: 'auto', vertical: 'hidden', mouseWheelHorizontal: true }}>
          <div className="scn-graph-thumbs">
            {scenarios.map((s, i) => (
              <div
                key={s.id}
                role="button"
                tabIndex={0}
                className={`scn-graph-thumb${i === selectedIndex ? ' is-selected' : ''}`}
                onClick={() => { setSelected(i); setFocusNode(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(i); setFocusNode(null) } }}
                data-testid={`scenario-run-graph-thumb-${i}`}
              >
                <span className="scn-graph-thumb-name" title={s.name}>{s.name}</span>
                <span className="scn-graph-thumb-canvas">
                  <ScenarioGraphPreview scenario={s as unknown as Scenario} interactive={false} testId={`scenario-run-graph-thumb-canvas-${i}`} />
                </span>
              </div>
            ))}
          </div>
        </ScrollableElement>
      )}
      <div className="scn-graph-detail" data-testid="scenario-run-graph-detail">
        {current ? (
          <ScenarioGraphPreview
            key={current.id}
            scenario={current as unknown as Scenario}
            interactive
            panMode="classic"
            focusNode={focusNode}
            testId="scenario-run-graph-detail-canvas"
          />
        ) : null}
      </div>
    </div>
  )
}

export default ScenarioRunGraphTab
