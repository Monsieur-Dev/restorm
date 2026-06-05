import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { SelectBox, InputBox, type ISelectData } from 'electron-core-ui/renderer'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { TypedValueField } from '../../TypedValueField'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence } from '../../../../../shared/utils/valuePersistence'
import { StringValue } from '../../../../../shared/types/collections'
import { YAML_OPS, isYamlOp, type YamlOp } from '../../../../../shared/scenarioYaml'

/**
 * `yaml` — parses a YAML string into a value, or stringifies a value. The
 * operation picker (parse / stringify) drives the extra field: `stringify` shows
 * an `indent` (YAML always indents — default 2). The `value` operand is a
 * typed-value selector (wire a link — e.g. an `object` node into `stringify` —
 * or set it inline). Malformed YAML / a non-serialisable value surfaces on the
 * implicit `error` port. Op + indent + value persist in the node config.
 */
export const YamlNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}
  const op: YamlOp = isYamlOp(config['op']) ? config['op'] : 'parse'
  const indent = typeof config['indent'] === 'number' ? config['indent'] : 2

  const opOptions = YAML_OPS.map((o) => ({ text: o, label: t(`scenario.yaml.op.${o}`, o) }))

  const rows: ScenarioNodeCell[] = [
    {
      id: 'value',
      label: t('scenario.yaml.value', 'value'),
      port: { id: 'value', type: 'target' },
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <TypedValueField
            value={config['value'] !== undefined ? normalizeValueType(config['value']) : new StringValue('')}
            onChange={(next) => { data.onSetConfig?.(id, { value: serializeValueForPersistence(next) }) }}
            valueTypeGroups={valueTypeGroups}
            allowAllVariables
            dataTestId={`scn-yaml-value-${id}`}
          />
        </div>
      )
    },
    {
      id: 'operation',
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.yaml.operation', 'operation')}</div>
          <SelectBox
            id={`scn-yaml-op-${id}`}
            className=""
            options={opOptions}
            selected={Math.max(0, YAML_OPS.indexOf(op))}
            onDidSelect={(d: ISelectData) => { const next = YAML_OPS[d.index]; if (next) data.onSetConfig?.(id, { op: next }) }}
            data-testid="scn-yaml-op"
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
          <div className="scn-field-caption">{t('scenario.yaml.indent', 'indent')}</div>
          <InputBox
            value={String(indent)}
            onChange={(next) => { const n = Number.parseInt(next, 10); data.onSetConfig?.(id, { indent: Number.isFinite(n) ? n : 2 }) }}
            options={{ type: 'number', placeholder: '2' }}
            data-testid="scn-yaml-indent"
          />
        </div>
      )
    })
  }

  const left: ScenarioNodeSection[] = [{ id: 'main', rows }]
  const right: ScenarioNodeCell[] = [
    { id: 'result', label: t('scenario.yaml.result', 'result'), port: { id: 'result', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}

export default YamlNodeBox
