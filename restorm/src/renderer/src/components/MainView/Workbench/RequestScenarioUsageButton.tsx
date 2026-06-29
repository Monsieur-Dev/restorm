import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Tooltip } from 'electron-core-ui/renderer'
import { Badge } from '../../common/Badge'
import type { ScenarioRequestUsage } from '../../../services/scenarioRequestUsage'

export interface RequestScenarioUsageButtonProps {
  /** Scenarios referencing this request (already computed live from the tree). */
  usages: ScenarioRequestUsage[]
  /** Open a scenario tab; `focusNodeId` centres a box when the request is used
   * exactly once in that scenario. */
  onOpenScenario: (scenarioId: string, focusNodeId?: string) => void
}

/**
 * Reverse-navigation affordance shared by every request editor: a SCENARIO
 * badge button that appears only when the request is used by at least one
 * scenario. Clicking it opens an ECUI popover listing those scenarios as links
 * — the mirror of the scenario box's "Edit request" link. The button sits in
 * the request tab's top-right toolbar, between the bookmark ribbon and the
 * favourite star.
 */
export const RequestScenarioUsageButton: React.FC<RequestScenarioUsageButtonProps> = ({ usages, onOpenScenario }) => {
  const { t } = useTranslation()
  // Span wrapper provides a stable DOM ref for Tooltip anchoring and outside-click detection.
  const buttonRef = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)

  // Close on any outside click while the popover is open.
  useEffect(() => {
    if (!open) return undefined
    const onDocMouseDown = (e: MouseEvent): void => {
      if (buttonRef.current && !buttonRef.current.contains(e.target as globalThis.Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => { document.removeEventListener('mousedown', onDocMouseDown) }
  }, [open])

  if (usages.length === 0) return null

  const openScenario = (usage: ScenarioRequestUsage): void => {
    // Only centre a box when the request appears exactly once — otherwise it's
    // ambiguous which box to focus, so just open the scenario.
    const focusNodeId = usage.nodeIds.length === 1 ? usage.nodeIds[0] : undefined
    onOpenScenario(usage.scenario.id, focusNodeId)
    setOpen(false)
  }

  const label = t('scenario.usage.button', 'Scenarios using this request')
  return (
    <>
      <span
        ref={buttonRef}
        style={{ display: 'inline-flex' }}
        onMouseDown={(e) => { e.stopPropagation() }}
      >
        <Button
          className={`request-scenario-usage-button${open ? ' is-open' : ''}`}
          options={{ ariaLabel: label }}
          onClick={(e: React.MouseEvent) => { e.stopPropagation(); setOpen((v) => !v) }}
          onMouseEnter={() => { setHovered(true) }}
          onMouseLeave={() => { setHovered(false) }}
          data-testid="request-scenario-usage-button"
        >
          <Badge type="SCENARIO" />
        </Button>
      </span>
      <Tooltip
        targetRef={buttonRef}
        show={hovered && !open}
        placement="below"
        content={label}
      />
      <Tooltip
        targetRef={buttonRef}
        show={open}
        placement="below"
        data-testid="request-scenario-usage-popover"
        content={
          <div className="request-scenario-usage-popover" onMouseDown={(e) => { e.stopPropagation() }}>
            <div className="request-scenario-usage-title">{t('scenario.usage.title', 'This request is used in the scenarios:')}</div>
            <ul className="request-scenario-usage-list">
              {usages.map((usage) => (
                <li key={usage.scenario.id}>
                  <Button
                    link
                    className="request-scenario-usage-link"
                    onClick={() => { openScenario(usage) }}
                    data-testid={`request-scenario-usage-link-${usage.scenario.id}`}
                  >
                    <Badge type="SCENARIO" />
                    <span className="request-scenario-usage-name">{usage.scenario.name}</span>
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        }
      />
    </>
  )
}

export default RequestScenarioUsageButton
