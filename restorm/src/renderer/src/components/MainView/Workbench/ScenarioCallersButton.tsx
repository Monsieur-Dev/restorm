import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tooltip } from 'electron-core-ui/renderer'
import { Badge } from '../../common/Badge'
import type { ScenarioScenarioUsage } from '../../../services/scenarioRequestUsage'

export interface ScenarioCallersButtonProps {
  /** Scenarios with a `runScenario` node referencing the current scenario. */
  usages: ScenarioScenarioUsage[]
  /** Open a scenario tab; `focusNodeId` centres the `runScenario` box when the
   * caller references this scenario exactly once. */
  onOpenScenario: (scenarioId: string, focusNodeId?: string) => void
}

/**
 * Reverse-navigation affordance for the scenario editor: a SCENARIO badge
 * button that appears only when at least one other scenario references the
 * current one via a `runScenario` node. Clicking it opens an ECUI popover
 * listing every caller as a jumpable link — mirror of
 * {@link RequestScenarioUsageButton}, scenario→scenario.
 */
export const ScenarioCallersButton: React.FC<ScenarioCallersButtonProps> = ({ usages, onOpenScenario }) => {
  const { t } = useTranslation()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return undefined
    const onDocMouseDown = (e: MouseEvent): void => {
      if (buttonRef.current && !buttonRef.current.contains(e.target as globalThis.Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => { document.removeEventListener('mousedown', onDocMouseDown) }
  }, [open])

  if (usages.length === 0) return null

  const openCaller = (usage: ScenarioScenarioUsage): void => {
    // Only centre a box when the caller references this scenario exactly once
    // — otherwise the focus target is ambiguous.
    const focusNodeId = usage.nodeIds.length === 1 ? usage.nodeIds[0] : undefined
    onOpenScenario(usage.scenario.id, focusNodeId)
    setOpen(false)
  }

  const label = t('scenario.callers.button', 'Scenarios calling this scenario')
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`request-scenario-usage-button${open ? ' is-open' : ''}`}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        onMouseDown={(e) => { e.stopPropagation() }}
        data-testid="scenario-callers-button"
      >
        <Badge type="SCENARIO" />
      </button>
      <Tooltip
        targetRef={buttonRef}
        show={open}
        placement="below"
        data-testid="scenario-callers-popover"
        content={
          <div className="request-scenario-usage-popover" onMouseDown={(e) => { e.stopPropagation() }}>
            <div className="request-scenario-usage-title">{t('scenario.callers.title', 'This scenario is called by:')}</div>
            <ul className="request-scenario-usage-list">
              {usages.map((usage) => (
                <li key={usage.scenario.id}>
                  <button
                    type="button"
                    className="request-scenario-usage-link"
                    onClick={() => { openCaller(usage) }}
                    data-testid={`scenario-callers-link-${usage.scenario.id}`}
                  >
                    <Badge type="SCENARIO" />
                    <span className="request-scenario-usage-name">{usage.scenario.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        }
      />
    </>
  )
}

export default ScenarioCallersButton
