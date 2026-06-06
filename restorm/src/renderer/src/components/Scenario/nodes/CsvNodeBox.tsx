import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { SelectBox, InputBox, Toggle, type ISelectData } from 'electron-core-ui/renderer'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { TypedValueField } from '../../TypedValueField'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence } from '../../../../../shared/utils/valuePersistence'
import { StringValue } from '../../../../../shared/types/collections'
import { CSV_OPS, isCsvOp, type CsvOp } from '../../../../../shared/scenarioCsv'

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

  const opOptions = CSV_OPS.map((o) => ({ text: o, label: t(`scenario.csv.op.${o}`, o) }))

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
            allowAllVariables
            dataTestId={`scn-csv-value-${id}`}
          />
        </div>
      )
    },
    {
      id: 'operation',
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.csv.operation', 'operation')}</div>
          <SelectBox
            id={`scn-csv-op-${id}`}
            className=""
            options={opOptions}
            selected={Math.max(0, CSV_OPS.indexOf(op))}
            onDidSelect={(d: ISelectData) => { const next = CSV_OPS[d.index]; if (next) data.onSetConfig?.(id, { op: next }) }}
            data-testid="scn-csv-op"
          />
        </div>
      )
    },
    {
      id: 'delimiter',
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
