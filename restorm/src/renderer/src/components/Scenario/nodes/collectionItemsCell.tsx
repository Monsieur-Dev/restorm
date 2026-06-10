import { TypedValueField } from '../../TypedValueField'
import type { ValueTypeKind } from '../../TypedValueField/castValue'
import type { EnvValueTypeGroup } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence } from '../../../../../shared/utils/valuePersistence'
import { VariableValue } from '../../../../../shared/types/collections'
import type { ScenarioNodeBoxData, ScenarioNodeCell } from './ScenarioNodeBoxBase'

/**
 * The `items` selector of a collection node offers ONLY list-typed sources: an
 * API enum as a list (`enumList`), a custom list as a list (`customListMulti`),
 * or a list-typed variable. Every scalar/single kind is excluded — a collection
 * node iterates/reduces a collection, not a scalar. `variable` is NOT excluded
 * here: the value selector filters the Variables menu by each variable's
 * declared type, so only list-typed variables surface.
 */
const ITEMS_NON_LIST_TYPES: ValueTypeKind[] = [
  'string', 'secret', 'number', 'dateTime', 'color', 'expression', 'boolean', 'enum', 'customList'
]

/** A list-typed source exists iff some env group carries an enum or a custom
 * list (each yields a `(list)` option in the selector). */
export function hasListTypeAvailable(groups: EnvValueTypeGroup[]): boolean {
  return groups.some((g) => g.enumDefinitions.length > 0 || g.customValueLists.length > 0)
}

/**
 * The `items` input cell shared by the collection nodes (forEach / aggregate /
 * …). When the env exposes a list type it's a value selector restricted to list
 * types and the anchor is neutral; otherwise nothing can be picked, so it stays
 * a red required port until wired. {@link ScenarioInputCell} swaps the cell for
 * the JSON-path selector once a data link is connected.
 */
export function buildListItemsCell(args: {
  id: string
  data: ScenarioNodeBoxData
  valueTypeGroups: EnvValueTypeGroup[]
  label: string
  dataTestId: string
}): ScenarioNodeCell {
  const { id, data, valueTypeGroups, label, dataTestId } = args
  const hasListType = hasListTypeAvailable(valueTypeGroups)
  const config = data.config ?? {}
  return {
    id: 'items',
    label,
    port: { id: 'items', type: 'target', required: !hasListType },
    ...(hasListType
      ? {
          content: (
            <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
              <TypedValueField
                // `items` is a list slot, never an authoring field — default to a
                // (list-typed) variable picker, not a string. The type menu still
                // offers the list literals (enumList / customListMulti).
                value={config['items'] !== undefined ? normalizeValueType(config['items']) : new VariableValue('')}
                onChange={(next) => { data.onSetConfig?.(id, { items: serializeValueForPersistence(next) }) }}
                valueTypeGroups={valueTypeGroups}
                excludeTypes={ITEMS_NON_LIST_TYPES}
                dataTestId={dataTestId}
              />
            </div>
          )
        }
      : {})
  }
}
