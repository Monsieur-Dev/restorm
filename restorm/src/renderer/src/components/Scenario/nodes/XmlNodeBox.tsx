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
import { XML_OPS, isXmlOp, type XmlOp } from '../../../../../shared/scenarioXml'
import { STRING_VALUE_EXCLUDE } from './valueTypePolicies'

/**
 * `xml` — parses an XML string into an object, or stringifies a value. The
 * operation picker (parse / stringify) drives the extra field: `stringify` shows
 * an `indent` for pretty-printing. The `value` operand is a typed-value selector
 * (wire a link — e.g. an `object` node into `stringify` — or set it inline).
 * Malformed XML / a non-serialisable value surfaces on the implicit `error`
 * port. Op + indent + value persist in the node config.
 */
export const XmlNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}
  const op: XmlOp = isXmlOp(config['op']) ? config['op'] : 'parse'
  const indent = typeof config['indent'] === 'number' ? config['indent'] : 0

  const rows: ScenarioNodeCell[] = [
    {
      id: 'value',
      label: t('scenario.xml.value', 'value'),
      port: { id: 'value', type: 'target' },
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <TypedValueField
            value={config['value'] !== undefined ? normalizeValueType(config['value']) : new StringValue('')}
            onChange={(next) => { data.onSetConfig?.(id, { value: serializeValueForPersistence(next) }) }}
            valueTypeGroups={valueTypeGroups}
            excludeTypes={STRING_VALUE_EXCLUDE}
            allowAllVariables
            dataTestId={`scn-xml-value-${id}`}
            multilineLanguage="xml"
          />
        </div>
      )
    },
    {
      id: 'operation',
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.xml.operation', 'operation')}</div>
          <SegmentedToggle
            options={XML_OPS}
            labels={XML_OPS.map((o) => t(`scenario.xml.op.${o}`, o))}
            value={op}
            onChange={(next) => { if (isXmlOp(next)) data.onSetConfig?.(id, { op: next }) }}
            ariaLabel={t('scenario.xml.operation', 'operation')}
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
          <div className="scn-field-caption">{t('scenario.xml.indent', 'indent')}</div>
          <InputBox
            value={String(indent)}
            onChange={(next) => { const n = Number.parseInt(next, 10); data.onSetConfig?.(id, { indent: Number.isFinite(n) ? n : 0 }) }}
            options={{ type: 'number', placeholder: '0' }}
            data-testid="scn-xml-indent"
          />
        </div>
      )
    })
  }

  const left: ScenarioNodeSection[] = [{ id: 'main', rows }]
  const right: ScenarioNodeCell[] = [
    { id: 'result', label: t('scenario.xml.result', 'result'), port: { id: 'result', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}
