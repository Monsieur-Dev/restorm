import React, { useEffect, useRef, useState } from 'react'
import { useExclusiveHeaderPopover } from '../../../hooks/useExclusiveHeaderPopover'
import { useTranslation } from 'react-i18next'
import { Button, Tooltip } from 'electron-core-ui/renderer'
import { HeaderHoverTooltip } from '../HeaderHoverTooltip'
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
  // Span wrapper provides a stable DOM ref for Tooltip anchoring and outside-click detection.
  const buttonRef = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  // Opening this popover closes any sibling header popover (and vice versa).
  useExclusiveHeaderPopover(open, () => { setOpen(false) })

  useEffect(() => {
    if (!open) return undefined
    const onDocMouseDown = (e: MouseEvent): void => {
      if (buttonRef.current && !buttonRef.current.contains(e.target as globalThis.Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => { document.removeEventListener('mousedown', onDocMouseDown) }
  }, [open])

  // Every open tab keeps its toolbar mounted, hidden ones included — and a
  // `display: none` anchor never fires mouseleave. Force both overlays shut
  // the moment the anchor stops intersecting the viewport, so no tooltip or
  // popover ever stays stranded on a collapsed 0,0 anchor rect.
  useEffect(() => {
    const el = buttonRef.current
    if (!el) return undefined
    const observer = new IntersectionObserver((entries) => {
      if (entries.every((entry) => !entry.isIntersecting)) {
        setOpen(false)
      }
    })
    observer.observe(el)
    return () => { observer.disconnect() }
  }, [])

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
      <span
        ref={buttonRef}
        className={`request-scenario-usage-button${open ? ' is-open' : ''}`}
        onMouseDown={(e) => { e.stopPropagation() }}
      >
        {/* Same chrome as the request smartbar's scenario button: plain small
            Button in a HeaderHoverTooltip, SCENARIO badge as the icon. */}
        <HeaderHoverTooltip label={label} suppressed={open} placement="below">
          <Button
            small
            options={{ ariaLabel: label }}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); setOpen((v) => !v) }}
            data-testid="scenario-callers-button"
          >
            <Badge type="SCENARIO" />
          </Button>
        </HeaderHoverTooltip>
      </span>
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
                  <Button
                    link
                    className="request-scenario-usage-link"
                    onClick={() => { openCaller(usage) }}
                    data-testid={`scenario-callers-link-${usage.scenario.id}`}
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
