import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { buildListItemsCell } from './collectionItemsCell'
import { buildParallelismCell } from './parallelismCell'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'

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

  const right: ScenarioNodeCell[] = [
    { id: 'each', label: t('scenario.forEach.each', 'each'), port: { id: 'each', role: 'then', type: 'source' } },
    // Loop completion is the universal `Done` port (drawn by the box base), so
    // no explicit "done" row here — it would duplicate it.
    buildParallelismCell({ id, config, onSetConfig: data.onSetConfig, label: t('scenario.forEach.parallelism', 'parallelism'), testIdPrefix: 'scn-foreach' })
  ]

  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} launchInput />
}

export default ForEachNodeBox
