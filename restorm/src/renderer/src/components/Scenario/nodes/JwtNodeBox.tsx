import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { TypedValueField } from '../../TypedValueField'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence } from '../../../../../shared/utils/valuePersistence'
import { StringValue } from '../../../../../shared/types/collections'
import { STRING_VALUE_EXCLUDE } from './valueTypePolicies'

/**
 * `jwt` — decodes its `value` token string into `{ header, payload, signature }`
 * on `result` (the signature is the raw segment, NOT verified). A non-string or
 * malformed token surfaces on the implicit `error` port. The `value` operand is
 * a typed-value selector (wire a link — e.g. a login response's token — or set
 * it inline) and persists in the node config.
 */
export const JwtNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}

  const left: ScenarioNodeSection[] = [
    {
      id: 'main',
      rows: [
        {
          id: 'value',
          label: t('scenario.jwt.value', 'token'),
          port: { id: 'value', type: 'target' },
          content: (
            <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
              <TypedValueField
                value={config['value'] !== undefined ? normalizeValueType(config['value']) : new StringValue('')}
                onChange={(next) => { data.onSetConfig?.(id, { value: serializeValueForPersistence(next) }) }}
                valueTypeGroups={valueTypeGroups}
                excludeTypes={STRING_VALUE_EXCLUDE}
                allowAllVariables
                dataTestId={`scn-jwt-value-${id}`}
              />
            </div>
          )
        }
      ]
    }
  ]
  const right: ScenarioNodeCell[] = [
    { id: 'result', label: t('scenario.jwt.result', 'result'), port: { id: 'result', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}

export default JwtNodeBox
