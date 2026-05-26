import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { TypedValueField } from '../../TypedValueField'
import type { ValueTypeKind } from '../../TypedValueField/castValue'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence } from '../../../../../shared/utils/valuePersistence'
import { ExpressionValue } from '../../../../../shared/types/collections'

/** The transform body is always an expression: the value selector is locked to
 * the `expression` kind (every other type excluded), which renders the embedded
 * Handlebars/Monaco editor — same control as the KV tables' expression cells. */
const EXPRESSION_ONLY_EXCLUDE: ValueTypeKind[] = [
  'string', 'secret', 'number', 'dateTime', 'color', 'boolean', 'enum', 'enumList', 'customList', 'customListMulti', 'variable'
]

/**
 * `transform` ("Transform template") — applies an expression / Handlebars
 * template to its *optional* `value` input and emits the result on `out`. The
 * body is a typed-value field locked to the `expression` kind (the embedded
 * Monaco editor), persisted in config. The input is optional so the node runs
 * on its own as a pure template; wire `value` to transform an incoming value.
 * (Merges the former separate transform + template nodes.)
 */
export const TransformNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}
  const left: ScenarioNodeSection[] = [
    {
      id: 'main',
      rows: [
        { id: 'value', label: 'value', port: { id: 'value', type: 'target' } },
        {
          id: 'expr',
          content: (
            <div className="nodrag scn-template-field" onMouseDown={(e) => { e.stopPropagation() }}>
              <div className="scn-field-caption">{t('keyValueTable.types.expression', 'Expression')}</div>
              <TypedValueField
                value={config['expression'] !== undefined ? normalizeValueType(config['expression']) : new ExpressionValue('')}
                onChange={(next) => { data.onSetConfig?.(id, { expression: serializeValueForPersistence(next) }) }}
                valueTypeGroups={valueTypeGroups}
                excludeTypes={EXPRESSION_ONLY_EXCLUDE}
                dataTestId="scn-transform-expr"
              />
            </div>
          )
        }
      ]
    }
  ]
  const right: ScenarioNodeCell[] = [{ id: 'out', label: 'value', port: { id: 'out', type: 'source' } }]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} canPlay />
}
