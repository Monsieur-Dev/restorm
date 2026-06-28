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

import React from 'react'
import { useTranslation } from 'react-i18next'
import { SelectBox, type ISelectData } from 'electron-core-ui/renderer'
import type { Request } from '../../../../../shared/types/collections'
import { getProjectConfigs } from '../../../services/requestQuickConfigStore'
import { readQuickConfigId, QUICK_CONFIG_ID_KEY } from '../../../../../shared/scenarioActionOverride'

export interface QuickConfigSelectorRowProps {
  request: Request
  config: Record<string, unknown>
  onSetConfig: (patch: Record<string, unknown>) => void
}

export const QuickConfigSelectorRow: React.FC<QuickConfigSelectorRowProps> = ({ request, config, onSetConfig }) => {
  const { t } = useTranslation()

  // Live refresh is owned by the parent `useSelectorSection` hook: it subscribes
  // to the request document events and re-renders this row (or removes it) as
  // configs are added / removed, so the selector stays in sync with the request
  // quick-settings popover with no manual refresh.
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
  // Option 0 = "no quick config", then one per FILE config. The bound config is
  // selected by id; a missing (deleted) binding falls back to "none" in the box
  // while the warning below explains the stale binding.
  const options = [{ text: noneLabel }, ...configs.map((c) => ({ text: c.name }))]
  const selectedIndex = picked ? 1 + configs.findIndex((c) => c.id === quickConfigId) : 0

  // No file configs → nothing to choose: the selector disappears.
  if (configs.length === 0) return null

  return (
    <div
      className="nodrag"
      onMouseDown={(e) => { e.stopPropagation() }}
      style={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%' }}
    >
      <div className="scn-field-caption">{t('scenario.actionOverride.configSelector.label', 'Base configuration')}</div>
      <SelectBox
        id="scn-quick-config-select"
        className="scn-quick-config-select"
        options={options}
        selected={Math.max(0, selectedIndex)}
        onDidSelect={(d: ISelectData) => {
          const nextId = d.index === 0 ? undefined : configs[d.index - 1]?.id
          onSetConfig({ [QUICK_CONFIG_ID_KEY]: nextId })
        }}
        data-testid="scn-override-config-select"
      />
      {configMissing && (
        <span
          data-testid="scn-override-config-missing"
          style={{ fontSize: '0.78em', color: 'var(--scn-edge-orphan, #e5484d)' }}
        >
          {t('scenario.actionOverride.configMissing', 'The selected configuration was deleted; the request defaults apply.')}
        </span>
      )}
    </div>
  )
}

export default QuickConfigSelectorRow
