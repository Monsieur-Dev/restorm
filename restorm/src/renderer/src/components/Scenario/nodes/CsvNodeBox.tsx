import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { InputBox, Toggle } from 'electron-core-ui/renderer'
import { SegmentedToggle } from './SegmentedToggle'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { TypedValueField } from '../../TypedValueField'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence } from '../../../../../shared/utils/valuePersistence'
import { StringValue } from '../../../../../shared/types/collections'
import { CSV_OPS, isCsvOp, type CsvOp } from '../../../../../shared/scenarioCsv'
import { STRING_VALUE_EXCLUDE } from './valueTypePolicies'

/**
 * `csv` — the CSV member of the data-format family (json / xml / yaml): `parse`
 * a CSV string into rows, `stringify` a list back to CSV. `delimiter` + `header`
 * are config. The wrong operand shape surfaces on the implicit `error` port.
 */
export const CsvNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}
  const op: CsvOp = isCsvOp(config['op']) ? config['op'] : 'parse'
  const delimiter = typeof config['delimiter'] === 'string' ? config['delimiter'] : ''
  const header = config['header'] !== false

  const rows: ScenarioNodeCell[] = [
    {
      id: 'value',
      label: t('scenario.csv.value', 'value'),
      port: { id: 'value', type: 'target' },
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <TypedValueField
            value={config['value'] !== undefined ? normalizeValueType(config['value']) : new StringValue('')}
            onChange={(next) => { data.onSetConfig?.(id, { value: serializeValueForPersistence(next) }) }}
            valueTypeGroups={valueTypeGroups}
            excludeTypes={STRING_VALUE_EXCLUDE}
            allowAllVariables
            dataTestId={`scn-csv-value-${id}`}
            multilineLanguage="csv"
          />
        </div>
      )
    },
    {
      id: 'operation',
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.csv.operation', 'operation')}</div>
          <SegmentedToggle
            options={CSV_OPS}
            labels={CSV_OPS.map((o) => t(`scenario.csv.op.${o}`, o))}
            value={op}
            onChange={(next) => { if (isCsvOp(next)) data.onSetConfig?.(id, { op: next }) }}
            ariaLabel={t('scenario.csv.operation', 'operation')}
          />
        </div>
      )
    },
    {
      id: 'delimiter',
      port: { id: 'delimiter', type: 'target' },
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.csv.delimiter', 'delimiter')}</div>
          <InputBox
            value={delimiter}
            onChange={(next) => { data.onSetConfig?.(id, { delimiter: next }) }}
            options={{ type: 'text', placeholder: ',' }}
            data-testid="scn-csv-delimiter"
          />
        </div>
      )
    },
    {
      id: 'header',
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <Toggle
            checked={header}
            onChange={(checked) => { data.onSetConfig?.(id, { header: checked }) }}
            data-testid="scn-csv-header"
          >
            {t('scenario.csv.header', 'header row')}
          </Toggle>
        </div>
      )
    }
  ]

  const left: ScenarioNodeSection[] = [{ id: 'main', rows }]
  const right: ScenarioNodeCell[] = [
    { id: 'result', label: t('scenario.csv.result', 'result'), port: { id: 'result', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}

export default CsvNodeBox
