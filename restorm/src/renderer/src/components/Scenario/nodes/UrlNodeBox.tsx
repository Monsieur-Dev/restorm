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
import { URL_OPS, isUrlOp, type UrlOp } from '../../../../../shared/scenarioUrl'
import { STRING_VALUE_EXCLUDE } from './valueTypePolicies'

/**
 * `url` — encode / decode a component, parse / build a query string, or parse a
 * URL. The operation picker drives the meaning of `value` (a string, or an
 * object for buildQuery). A malformed input surfaces on the implicit `error`
 * port. Op + value persist in the node config.
 */
export const UrlNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}
  const op: UrlOp = isUrlOp(config['op']) ? config['op'] : 'encode'

  const opOptions = URL_OPS.map((o) => ({ text: o, label: t(`scenario.url.op.${o}`, o) }))

  const left: ScenarioNodeSection[] = [
    {
      id: 'main',
      rows: [
        {
          id: 'value',
          label: t('scenario.url.value', 'value'),
          port: { id: 'value', type: 'target' },
          content: (
            <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
              <TypedValueField
                value={config['value'] !== undefined ? normalizeValueType(config['value']) : new StringValue('')}
                onChange={(next) => { data.onSetConfig?.(id, { value: serializeValueForPersistence(next) }) }}
                valueTypeGroups={valueTypeGroups}
                excludeTypes={STRING_VALUE_EXCLUDE}
                allowAllVariables
                dataTestId={`scn-url-value-${id}`}
              />
            </div>
          )
        },
        {
          id: 'operation',
          content: (
            <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
              <div className="scn-field-caption">{t('scenario.url.operation', 'operation')}</div>
              <SelectBox
                id={`scn-url-op-${id}`}
                className=""
                options={opOptions}
                selected={Math.max(0, URL_OPS.indexOf(op))}
                onDidSelect={(d: ISelectData) => { const next = URL_OPS[d.index]; if (next) data.onSetConfig?.(id, { op: next }) }}
                data-testid="scn-url-op"
              />
            </div>
          )
        }
      ]
    }
  ]
  const right: ScenarioNodeCell[] = [
    { id: 'result', label: t('scenario.url.result', 'result'), port: { id: 'result', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}
