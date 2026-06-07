import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { SelectBox, type ISelectData } from 'electron-core-ui/renderer'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { TypedValueField } from '../../TypedValueField'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence } from '../../../../../shared/utils/valuePersistence'
import { StringValue } from '../../../../../shared/types/collections'
import { SCENARIO_CAST_TYPES, isScenarioCastType, type ScenarioCastType } from '../../../../../shared/scenarioCast'

/**
 * `cast` — converts its `value` input to the configured target type. Strict
 * comparisons / aggregates never coerce, so this node is the explicit escape
 * hatch (`"5"` → number, a boolean → string, any value → a single-element
 * list…). The `value` operand is a typed-value selector (wire a link, or set it
 * inline); the target type drives the conversion and the output type. An
 * impossible cast surfaces on the implicit `error` port at run time. Target +
 * value persist in the node config.
 */
export const CastNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}
  const target: ScenarioCastType = isScenarioCastType(config['targetType']) ? config['targetType'] : 'string'

  const typeOptions = SCENARIO_CAST_TYPES.map((ty) => ({ text: ty, label: t(`scenario.cast.type.${ty}`, ty) }))

  const left: ScenarioNodeSection[] = [
    {
      id: 'main',
      rows: [
        {
          id: 'value',
          label: t('scenario.cast.value', 'value'),
          port: { id: 'value', type: 'target' },
          content: (
            <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
              <TypedValueField
                value={config['value'] !== undefined ? normalizeValueType(config['value']) : new StringValue('')}
                onChange={(next) => { data.onSetConfig?.(id, { value: serializeValueForPersistence(next) }) }}
                valueTypeGroups={valueTypeGroups}
                // Any value can be cast — list every variable regardless of its
                // declared type, exactly like the arithmetic operand picker.
                allowAllVariables
                dataTestId={`scn-cast-value-${id}`}
              />
            </div>
          )
        },
        {
          id: 'targetType',
          content: (
            <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
              <div className="scn-field-caption">{t('scenario.cast.targetType', 'cast to')}</div>
              <SelectBox
                id={`scn-cast-type-${id}`}
                className=""
                options={typeOptions}
                selected={Math.max(0, SCENARIO_CAST_TYPES.indexOf(target))}
                onDidSelect={(d: ISelectData) => { const next = SCENARIO_CAST_TYPES[d.index]; if (next) data.onSetConfig?.(id, { targetType: next }) }}
                data-testid="scn-cast-type"
              />
            </div>
          )
        }
      ]
    }
  ]
  const right: ScenarioNodeCell[] = [
    { id: 'result', label: t('scenario.cast.result', 'result'), port: { id: 'result', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}

export default CastNodeBox
