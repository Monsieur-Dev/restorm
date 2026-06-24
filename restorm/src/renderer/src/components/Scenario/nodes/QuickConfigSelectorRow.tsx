/**
 * Quick-setting selector for a request-binding scenario action's box. A DROPDOWN
 * BUTTON (chooser, NOT a dataflow port) that picks a saved quick-config
 * (TASK-66.25) as the action's BASE config, by id.
 *
 * Behaviour (Yoann spec, AC#8/#9):
 *  - INVISIBLE when the bound request has no file/project config.
 *  - The dropdown menu's first item is "no quick config" (none / inherit), then
 *    one item per FILE config. ONLY file-saved (project-target) configs are
 *    listed — a scenario lives in the .restorm file and must stay portable, so
 *    it cannot bind a user-local settings config.
 *  - When the selected config is DELETED on the request: the selector deselects
 *    it and DROPS the stale id from the node config; if no file configs remain,
 *    the whole button disappears.
 *
 * Stays in sync LIVE with the request's quick-settings: it subscribes to the
 * REQUEST document events the reactive proxy fires on add / overwrite / delete,
 * so a config added or removed on the request re-renders this selector with no
 * manual workbench refresh (the `quickConfigs` array mutates in place — object
 * identity never changes — so an explicit re-render bump is required).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { Button, ContextMenu, eventBus, type ContextMenuItem } from 'electron-core-ui/renderer'
import type { Request } from '../../../../../shared/types/collections'
import { getProjectConfigs } from '../../../services/requestQuickConfigStore'
import { DocumentEvents } from '../../../services/DocumentEvents'
import { readQuickConfigId, QUICK_CONFIG_ID_KEY } from '../../../../../shared/scenarioActionOverride'

export interface QuickConfigSelectorRowProps {
  request: Request
  config: Record<string, unknown>
  onSetConfig: (patch: Record<string, unknown>) => void
}

export const QuickConfigSelectorRow: React.FC<QuickConfigSelectorRowProps> = ({ request, config, onSetConfig }) => {
  const { t } = useTranslation()
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  // Live refresh: the request's `quickConfigs` array mutates in place (its
  // object identity never changes), so subscribe to the REQUEST document events
  // and bump a tick to re-read the list whenever a config is added / overwritten
  // / deleted — keeping this selector in sync with the request's quick-settings
  // popover with no manual refresh.
  const [, setTick] = useState(0)
  useEffect(() => {
    const bump = (): void => { setTick((n) => n + 1) }
    const subs = [
      eventBus.subscribe(DocumentEvents.REQUEST_UPDATED, bump),
      eventBus.subscribe(DocumentEvents.REQUEST_CREATED, bump),
      eventBus.subscribe(DocumentEvents.REQUEST_DELETED, bump)
    ]
    return () => { subs.forEach((s) => { s.unsubscribe() }) }
  }, [])

  const configs = getProjectConfigs(request)
  const quickConfigId = readQuickConfigId(config)
  const picked = quickConfigId !== undefined ? configs.find((c) => c.id === quickConfigId) : undefined
  // The bound config id no longer resolves on the request (deleted / renamed
  // away). Binding is by id, so we KEEP it (a re-added config with the same id
  // re-links) but the selector shows it as "config missing" + the action falls
  // back to the request's DEFAULT config at run time — the engine's
  // resolveProjectConfigFields returns undefined for a missing id, so no config
  // layer is applied (request defaults), never a crash or silent-wrong run.
  const configMissing = quickConfigId !== undefined && picked === undefined

  const noneLabel = t('scenario.actionOverride.configSelector.none', 'No quick config')
  const items: ContextMenuItem[] = [
    {
      id: '__none',
      label: noneLabel,
      checked: picked === undefined,
      onClick: () => { onSetConfig({ [QUICK_CONFIG_ID_KEY]: undefined }) },
      'data-testid': 'scn-override-config-item-none'
    },
    ...configs.map((c): ContextMenuItem => ({
      id: c.id,
      label: c.name,
      checked: c.id === quickConfigId,
      onClick: () => { onSetConfig({ [QUICK_CONFIG_ID_KEY]: c.id }) },
      'data-testid': `scn-override-config-item-${c.id}`
    }))
  ]

  const openMenu = useCallback((e: React.MouseEvent): void => {
    e.stopPropagation()
    const rect = anchorRef.current?.getBoundingClientRect()
    setMenu(rect ? { x: rect.left, y: rect.bottom } : { x: e.clientX, y: e.clientY })
  }, [])

  // No file configs → nothing to choose: the button disappears.
  if (configs.length === 0) return null

  return (
    <span
      ref={anchorRef}
      className="nodrag"
      onMouseDown={(e) => { e.stopPropagation() }}
      style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}
    >
      <div className="scn-field-caption">{t('scenario.actionOverride.configSelector.label', 'Base configuration')}</div>
      <Button
        secondary
        line
        align="left"
        icon="chevron-down"
        data-testid="scn-override-config-select"
        onClick={openMenu}
      >
        {picked ? picked.name : (configMissing ? t('scenario.actionOverride.configMissingShort', 'Configuration missing') : noneLabel)}
      </Button>
      {configMissing && (
        <span
          data-testid="scn-override-config-missing"
          style={{ fontSize: '0.78em', color: 'var(--scn-edge-orphan, #e5484d)' }}
        >
          {t('scenario.actionOverride.configMissing', 'The selected configuration was deleted; the request defaults apply.')}
        </span>
      )}
      {menu && createPortal(
        <ContextMenu
          visible
          x={menu.x}
          y={menu.y}
          items={items}
          onRequestClose={() => { setMenu(null) }}
          data-testid="scn-override-config-menu"
        />,
        document.querySelector('.workbench') ?? document.body
      )}
    </span>
  )
}

export default QuickConfigSelectorRow
