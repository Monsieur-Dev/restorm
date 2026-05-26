import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { buildListItemsCell } from './collectionItemsCell'
import { TypedValueField } from '../../TypedValueField'
import type { ValueTypeKind } from '../../TypedValueField/castValue'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence } from '../../../../../shared/utils/valuePersistence'
import { ExpressionValue } from '../../../../../shared/types/collections'

/** The per-item transform is always an expression: the value selector is locked
 * to the `expression` kind, rendering the embedded Handlebars/Monaco editor. */
const EXPRESSION_ONLY_EXCLUDE: ValueTypeKind[] = [
  'string', 'secret', 'number', 'dateTime', 'color', 'boolean', 'enum', 'enumList', 'customList', 'customListMulti', 'variable'
]

/**
 * `map` — transforms each item of a collection into a new collection `mapped`.
 * `items` is the shared list-typed collection selector; the transform is a
 * per-item expression (a value field locked to `expression`, so it renders the
 * embedded Monaco/Handlebars editor). No header trigger — data-driven. The
 * collection source + expression persist in config.
 */
export const MapNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}

  const left: ScenarioNodeSection[] = [
    {
      id: 'main',
      rows: [
        buildListItemsCell({ id, data, valueTypeGroups, label: t('scenario.map.items', 'items'), dataTestId: 'scn-map-items' }),
        {
          id: 'expr',
          content: (
            <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
              <TypedValueField
                value={config['expression'] !== undefined ? normalizeValueType(config['expression']) : new ExpressionValue('')}
                onChange={(next) => { data.onSetConfig?.(id, { expression: serializeValueForPersistence(next) }) }}
                valueTypeGroups={valueTypeGroups}
                excludeTypes={EXPRESSION_ONLY_EXCLUDE}
                dataTestId="scn-map-expr"
              />
            </div>
          )
        }
      ]
    }
  ]
  const right: ScenarioNodeCell[] = [
    { id: 'mapped', label: t('scenario.map.mapped', 'mapped'), port: { id: 'mapped', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}

export default MapNodeBox
