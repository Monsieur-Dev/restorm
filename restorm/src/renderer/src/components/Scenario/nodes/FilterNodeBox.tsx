import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { InputBox } from 'electron-core-ui/renderer'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { OperatorToggle, OPERATOR_OPTIONS, type OperatorOption } from './OperatorToggle'
import { buildListItemsCell } from './collectionItemsCell'
import { TypedValueField } from '../../TypedValueField'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence } from '../../../../../shared/utils/valuePersistence'

/**
 * `filter` — keep the items matching a predicate, producing `kept`. The
 * predicate is a per-item comparison `field <operator> value`: `field` is a
 * path into each item (empty = the item itself, for scalar lists), the operator
 * reuses the shared {@link OperatorToggle}, and the comparison value is a typed
 * value selector (like the `if` operands). `items` is the shared list-typed
 * collection selector; a header trigger lets it chain. Predicate persists in
 * the node config bag.
 */
export const FilterNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}

  const field = typeof config['field'] === 'string' ? config['field'] : ''
  const rawOp = config['operator']
  const operator: OperatorOption | undefined =
    typeof rawOp === 'string' && (OPERATOR_OPTIONS as readonly string[]).includes(rawOp) ? (rawOp as OperatorOption) : undefined

  const left: ScenarioNodeSection[] = [
    {
      id: 'main',
      rows: [
        buildListItemsCell({ id, data, valueTypeGroups, label: t('scenario.filter.items', 'items'), dataTestId: 'scn-filter-items' }),
        {
          id: 'predicate',
          content: <div className="scn-field-caption">{t('scenario.filter.keepWhere', 'keep where')}</div>
        },
        {
          id: 'field',
          content: (
            <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
              <InputBox
                value={field}
                onChange={(next) => { data.onSetConfig?.(id, { field: next }) }}
                options={{ type: 'text', placeholder: '$.level' }}
                data-testid="scn-filter-field"
              />
            </div>
          )
        },
        {
          id: 'operator',
          content: (
            <OperatorToggle
              {...(operator !== undefined ? { value: operator } : {})}
              onChange={(op) => { data.onSetConfig?.(id, { operator: op }) }}
            />
          )
        },
        {
          id: 'value',
          content: (
            <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
              <TypedValueField
                value={normalizeValueType(config['value'])}
                onChange={(next) => { data.onSetConfig?.(id, { value: serializeValueForPersistence(next) }) }}
                valueTypeGroups={valueTypeGroups}
                excludeTypes={['expression']}
                dataTestId="scn-filter-value"
              />
            </div>
          )
        }
      ]
    }
  ]
  const right: ScenarioNodeCell[] = [
    { id: 'kept', label: t('scenario.filter.kept', 'kept'), port: { id: 'kept', type: 'source' } },
    { id: 'rejected', label: t('scenario.filter.rejected', 'rejected'), port: { id: 'rejected', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}

export default FilterNodeBox
