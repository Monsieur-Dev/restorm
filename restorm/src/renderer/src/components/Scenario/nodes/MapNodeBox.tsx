import React, { useMemo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import type { VariableDefinition } from 'electron-core-ui/renderer'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { ScenarioExpressionField } from './ScenarioExpressionField'
import { buildListItemsCell } from './collectionItemsCell'
import { useScenarioStaticPreview } from '../scenarioStaticPreviewContext'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'

/** Short preview of an item-key value used as a variable name in the
 * autocomplete row (primitives stringified, objects/arrays compacted so the
 * popup stays one line). */
function shortPreview(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v.length > 32 ? `"${v.slice(0, 32)}…"` : `"${v}"`
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  if (Array.isArray(v)) return `[${v.length}]`
  return '{…}'
}

/**
 * `map` — transforms each item of a collection into a new collection `mapped`.
 * `items` is the shared list-typed collection selector; the transform is a
 * per-item expression (Handlebars editor). Ctrl+Space surfaces the per-item
 * keys (from the first resolved item) + the full Handlebars helpers — same
 * shape as `transform`. No header trigger — data-driven. The collection
 * source + expression persist in config.
 */
export const MapNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const staticPreview = useScenarioStaticPreview()
  const config = data.config ?? {}
  const variables = useMemo<VariableDefinition[]>(() => {
    const sample = staticPreview?.getListItemShape(id) ?? null
    if (!sample) return []
    return Object.entries(sample).map(([name, val]) => ({ name, value: shortPreview(val) }))
  }, [id, staticPreview])

  const left: ScenarioNodeSection[] = [
    {
      id: 'main',
      rows: [
        buildListItemsCell({ id, data, valueTypeGroups, label: t('scenario.map.items', 'items'), dataTestId: 'scn-map-items' }),
        {
          id: 'expr',
          content: (
            <ScenarioExpressionField
              value={config['expression']}
              onChange={(next) => { data.onSetConfig?.(id, { expression: next }) }}
              valueTypeGroups={valueTypeGroups}
              variables={variables}
              expressionVariableId={`scn-map-${id}`}
              dataTestId="scn-map-expr"
            />
          )
        }
      ]
    }
  ]
  const right: ScenarioNodeCell[] = [
    { id: 'mapped', label: t('scenario.map.mapped', 'mapped'), port: { id: 'mapped', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}

export default MapNodeBox
