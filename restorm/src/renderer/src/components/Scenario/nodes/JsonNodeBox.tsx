import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { InputBox } from 'electron-core-ui/renderer'
import { SegmentedToggle } from './SegmentedToggle'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { TypedValueField } from '../../TypedValueField'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence } from '../../../../../shared/utils/valuePersistence'
import { StringValue } from '../../../../../shared/types/collections'
import { JSON_OPS, isJsonOp, type JsonOp } from '../../../../../shared/scenarioJson'
import { STRING_VALUE_EXCLUDE } from './valueTypePolicies'

/**
 * `json` — parses a JSON string into a value, or stringifies a value. The
 * operation picker (parse / stringify) drives the extra field: `stringify` shows
 * an `indent` for pretty-printing. The `value` operand is a typed-value selector
 * (wire a link — e.g. an `object` node into `stringify` — or set it inline).
 * Malformed JSON / a non-serialisable value surfaces on the implicit `error`
 * port. Op + indent + value persist in the node config.
 */
export const JsonNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}
  const op: JsonOp = isJsonOp(config['op']) ? config['op'] : 'parse'
  const indent = typeof config['indent'] === 'number' ? config['indent'] : 0

  const rows: ScenarioNodeCell[] = [
    {
      id: 'value',
      label: t('scenario.json.value', 'value'),
      port: { id: 'value', type: 'target' },
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <TypedValueField
            value={config['value'] !== undefined ? normalizeValueType(config['value']) : new StringValue('')}
            onChange={(next) => { data.onSetConfig?.(id, { value: serializeValueForPersistence(next) }) }}
            valueTypeGroups={valueTypeGroups}
            excludeTypes={STRING_VALUE_EXCLUDE}
            allowAllVariables
            dataTestId={`scn-json-value-${id}`}
            multilineLanguage="json"
          />
        </div>
      )
    },
    {
      id: 'operation',
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.json.operation', 'operation')}</div>
          <SegmentedToggle
            options={JSON_OPS}
            labels={JSON_OPS.map((o) => t(`scenario.json.op.${o}`, o))}
            value={op}
            onChange={(next) => { if (isJsonOp(next)) data.onSetConfig?.(id, { op: next }) }}
            ariaLabel={t('scenario.json.operation', 'operation')}
          />
        </div>
      )
    }
  ]

  if (op === 'stringify') {
    rows.push({
      id: 'indent',
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.json.indent', 'indent')}</div>
          <InputBox
            value={String(indent)}
            onChange={(next) => { const n = Number.parseInt(next, 10); data.onSetConfig?.(id, { indent: Number.isFinite(n) ? n : 0 }) }}
            options={{ type: 'number', placeholder: '0' }}
            data-testid="scn-json-indent"
          />
        </div>
      )
    })
  }

  const left: ScenarioNodeSection[] = [{ id: 'main', rows }]
  const right: ScenarioNodeCell[] = [
    { id: 'result', label: t('scenario.json.result', 'result'), port: { id: 'result', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}
