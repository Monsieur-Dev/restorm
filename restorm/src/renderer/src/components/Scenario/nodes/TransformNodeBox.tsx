import React, { useMemo } from 'react'
import { type NodeProps, useNodeConnections } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import type { VariableDefinition } from 'electron-core-ui/renderer'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { ScenarioExpressionField } from './ScenarioExpressionField'
import { useScenarioFieldInvalid } from '../scenarioErrorsContext'
import { useScenarioStaticPreview } from '../scenarioStaticPreviewContext'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'

/** Short hover preview of a value used as a variable in the expression
 * autocomplete — primitives stringified, objects/arrays compacted so the
 * popup row stays one-line readable. */
function shortPreview(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v.length > 32 ? `"${v.slice(0, 32)}…"` : `"${v}"`
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  if (Array.isArray(v)) return `[${v.length}]`
  return '{…}'
}

/**
 * `transform` ("Transform template") — applies an expression / Handlebars
 * template to its *optional* `value` input and emits the result on `out`. The
 * body is a typed-value field locked to the `expression` kind (the embedded
 * Monaco editor), persisted in config. The input is optional so the node runs
 * on its own as a pure template; wire `value` to transform an incoming value.
 * Ctrl+Space surfaces the source's top-level keys + the full Handlebars
 * helpers suite — same editor shape as `map`. */
export const TransformNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const staticPreview = useScenarioStaticPreview()
  const config = data.config ?? {}
  const exprInvalid = useScenarioFieldInvalid(id, 'expression')
  const valueConnections = useNodeConnections({ handleType: 'target', handleId: 'value' })
  const sourceId = valueConnections[0]?.source
  const variables = useMemo<VariableDefinition[]>(() => {
    if (!sourceId) return []
    const preview = staticPreview?.getPreview(sourceId) ?? null
    if (!preview) return []
    return Object.entries(preview).map(([name, val]) => ({ name, value: shortPreview(val) }))
  }, [sourceId, staticPreview])

  const left: ScenarioNodeSection[] = [
    {
      id: 'main',
      rows: [
        { id: 'value', label: 'value', port: { id: 'value', type: 'target' } },
        {
          id: 'expr',
          content: (
            <>
              <div className="scn-field-caption">{t('keyValueTable.types.expression', 'Expression')}</div>
              <ScenarioExpressionField
                value={config['expression']}
                onChange={(next) => { data.onSetConfig?.(id, { expression: next }) }}
                valueTypeGroups={valueTypeGroups}
                variables={variables}
                expressionVariableId={`scn-transform-${id}`}
                invalid={exprInvalid}
                dataTestId="scn-transform-expr"
              />
            </>
          )
        }
      ]
    }
  ]
  const right: ScenarioNodeCell[] = [{ id: 'out', label: 'value', port: { id: 'out', type: 'source' } }]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} canPlay />
}
