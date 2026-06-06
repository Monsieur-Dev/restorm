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
import { OBJECT_OPS, isObjectOp, type ObjectOp } from '../../../../../shared/scenarioObject'

/**
 * `objectOp` — reshapes its `value` object (distinct from the `object` builder).
 * The operation picker drives the extra fields: `path` (get/set), `keys`
 * (pick/omit), and a typed `other` operand (the value to set / the object to
 * merge). A non-object operand surfaces on the implicit `error` port.
 */
export const ObjectOpNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}
  const op: ObjectOp = isObjectOp(config['op']) ? config['op'] : 'get'
  const path = typeof config['path'] === 'string' ? config['path'] : ''
  const keys = typeof config['keys'] === 'string' ? config['keys'] : ''

  const opOptions = OBJECT_OPS.map((o) => ({ text: o, label: t(`scenario.objectOp.op.${o}`, o) }))

  const rows: ScenarioNodeCell[] = [
    {
      id: 'value',
      label: t('scenario.objectOp.value', 'object'),
      port: { id: 'value', type: 'target' },
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <TypedValueField
            value={config['value'] !== undefined ? normalizeValueType(config['value']) : new StringValue('')}
            onChange={(next) => { data.onSetConfig?.(id, { value: serializeValueForPersistence(next) }) }}
            valueTypeGroups={valueTypeGroups}
            allowAllVariables
            dataTestId={`scn-objectop-value-${id}`}
          />
        </div>
      )
    },
    {
      id: 'operation',
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.objectOp.operation', 'operation')}</div>
          <SelectBox
            id={`scn-objectop-op-${id}`}
            className=""
            options={opOptions}
            selected={Math.max(0, OBJECT_OPS.indexOf(op))}
            onDidSelect={(d: ISelectData) => { const next = OBJECT_OPS[d.index]; if (next) data.onSetConfig?.(id, { op: next }) }}
            data-testid="scn-objectop-op"
          />
        </div>
      )
    }
  ]

  if (op === 'get' || op === 'set') {
    rows.push({
      id: 'path',
      port: { id: 'path', type: 'target' },
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.objectOp.path', 'path')}</div>
          <InputBox
            value={path}
            onChange={(next) => { data.onSetConfig?.(id, { path: next }) }}
            options={{ type: 'text', placeholder: 'meta.tag' }}
            data-testid="scn-objectop-path"
          />
        </div>
      )
    })
  }

  if (op === 'pick' || op === 'omit') {
    rows.push({
      id: 'keys',
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{t('scenario.objectOp.keys', 'keys')}</div>
          <InputBox
            value={keys}
            onChange={(next) => { data.onSetConfig?.(id, { keys: next }) }}
            options={{ type: 'text', placeholder: 'id, name' }}
            data-testid="scn-objectop-keys"
          />
        </div>
      )
    })
  }

  if (op === 'set' || op === 'merge') {
    rows.push({
      id: 'other',
      content: (
        <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
          <div className="scn-field-caption">{op === 'merge' ? t('scenario.objectOp.mergeWith', 'merge with') : t('scenario.objectOp.setValue', 'value')}</div>
          <TypedValueField
            value={config['other'] !== undefined ? normalizeValueType(config['other']) : new StringValue('')}
            onChange={(next) => { data.onSetConfig?.(id, { other: serializeValueForPersistence(next) }) }}
            valueTypeGroups={valueTypeGroups}
            allowAllVariables
            dataTestId={`scn-objectop-other-${id}`}
          />
        </div>
      )
    })
  }

  const left: ScenarioNodeSection[] = [{ id: 'main', rows }]
  const right: ScenarioNodeCell[] = [
    { id: 'result', label: t('scenario.objectOp.result', 'result'), port: { id: 'result', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}

export default ObjectOpNodeBox
