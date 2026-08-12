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
 * `throw` — deliberately fails with a `message` (wired or inline). The failure
 * is routed to the node's implicit `error` port (or fails the run if nothing
 * handles it). For error branches + testing retry. No value output.
 */
export const ThrowNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}

  const left: ScenarioNodeSection[] = [
    {
      id: 'main',
      rows: [
        {
          id: 'message',
          label: t('scenario.throw.message', 'message'),
          port: { id: 'message', type: 'target' },
          content: (
            <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
              <TypedValueField
                value={config['message'] !== undefined ? normalizeValueType(config['message']) : new StringValue('')}
                onChange={(next) => { data.onSetConfig?.(id, { message: serializeValueForPersistence(next) }) }}
                valueTypeGroups={valueTypeGroups}
                excludeTypes={STRING_VALUE_EXCLUDE}
                allowAllVariables
                dataTestId={`scn-throw-message-${id}`}
              />
            </div>
          )
        }
      ]
    }
  ]
  const right: ScenarioNodeCell[] = []
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}
