import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { Toggle, InputBox } from 'electron-core-ui/renderer'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { buildListItemsCell } from './collectionItemsCell'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'

interface ParallelismConfig { enabled: boolean; count: number }

/** Read the persisted parallelism config, clamped to the min of 2. */
function readParallelism(config: Record<string, unknown>): ParallelismConfig {
  const raw = config['parallelism']
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    const count = typeof o['count'] === 'number' && o['count'] >= 2 ? Math.floor(o['count']) : 2
    return { enabled: o['enabled'] === true, count }
  }
  return { enabled: false, count: 2 }
}

/**
 * `forEach` — iterate a collection: emits `each` item, then `done`.
 *
 * `items` is a value selector restricted to list types (API enums / custom
 * lists rendered as `(list)`); {@link ScenarioInputCell} swaps it for the
 * JSON-path selector once a data link is connected. When the env exposes no
 * list type at all there's nothing to pick, so the anchor stays a red required
 * port until wired. A header launch trigger lets the node be chained, and a
 * parallelism row (checkbox + bounded count) configures concurrent iteration.
 */
export const ForEachNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}

  const itemsCell = buildListItemsCell({
    id, data, valueTypeGroups, label: t('scenario.forEach.items', 'items'), dataTestId: 'scn-foreach-items'
  })
  const left: ScenarioNodeSection[] = [{ id: 'main', rows: [itemsCell] }]

  const par = readParallelism(config)
  const right: ScenarioNodeCell[] = [
    { id: 'each', label: t('scenario.forEach.each', 'each'), port: { id: 'each', role: 'then', type: 'source' } },
    { id: 'done', label: t('scenario.forEach.done', 'done'), port: { id: 'done', role: 'else', type: 'source' } },
    {
      id: 'parallelism',
      content: (
        <div className="scn-foreach-parallelism nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <span className="scn-field-caption">{t('scenario.forEach.parallelism', 'parallelism')}</span>
          <Toggle
            checked={par.enabled}
            onChange={(checked) => { data.onSetConfig?.(id, { parallelism: { enabled: checked, count: par.count } }) }}
            aria-label={t('scenario.forEach.parallelism', 'parallelism')}
            data-testid="scn-foreach-parallelism-enabled"
          />
          <InputBox
            value={String(par.count)}
            onChange={(next) => {
              const n = Math.max(2, Math.floor(Number(next) || 2))
              data.onSetConfig?.(id, { parallelism: { enabled: par.enabled, count: n } })
            }}
            options={{ type: 'number', min: 2, ariaLabel: t('scenario.forEach.parallelism', 'parallelism') }}
            disabled={!par.enabled}
            data-testid="scn-foreach-parallelism-count"
          />
        </div>
      )
    }
  ]

  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}

export default ForEachNodeBox
