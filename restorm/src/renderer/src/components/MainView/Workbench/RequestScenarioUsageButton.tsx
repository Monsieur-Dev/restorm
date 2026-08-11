import React, { useEffect, useRef, useState } from 'react'
import { useExclusiveHeaderPopover } from '../../../hooks/useExclusiveHeaderPopover'
import { useTranslation } from 'react-i18next'
import { Button, Tooltip } from 'electron-core-ui/renderer'
import { HeaderHoverTooltip } from '../HeaderHoverTooltip'
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
  // Opening this popover closes any sibling header popover (and vice versa).
  useExclusiveHeaderPopover(open, () => { setOpen(false) })

  // Close on any outside click while the popover is open.
  useEffect(() => {
    if (!open) return undefined
    const onDocMouseDown = (e: MouseEvent): void => {
      if (buttonRef.current && !buttonRef.current.contains(e.target as globalThis.Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => { document.removeEventListener('mousedown', onDocMouseDown) }
  }, [open])

  // Every open tab keeps its toolbar mounted, hidden ones included — and a
  // `display: none` anchor never fires mouseleave. Without this guard, the
  // hover tooltip (stale `hovered`) or the click popover of a now-hidden
  // tab stays portaled on screen, anchored to a collapsed 0,0 rect (it
  // renders stranded at the top-left of the window). Force both overlays
  // shut the moment the anchor stops intersecting the viewport.
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
        className={`request-scenario-usage-button${open ? ' is-open' : ''}`}
        onMouseDown={(e) => { e.stopPropagation() }}
      >
        {/* Same chrome as the neighbouring history button (plain small
            icon Button in a HeaderHoverTooltip) — the four header actions
            (history, quick settings, scenarios, favourite) share one look. */}
        <HeaderHoverTooltip label={label} suppressed={open} placement="below">
          <Button
            small
            options={{ ariaLabel: label }}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); setOpen((v) => !v) }}
            data-testid="request-scenario-usage-button"
          >
            <Badge type="SCENARIO" />
          </Button>
        </HeaderHoverTooltip>
      </span>
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
