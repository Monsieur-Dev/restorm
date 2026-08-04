import React from 'react'
import type { NodeProps } from '@xyflow/react'
import type { TFunction } from 'i18next'
import { Button } from 'electron-core-ui/renderer'
import { useTranslation } from 'react-i18next'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { useScenarioNodeErrors } from '../scenarioErrorsContext'
import { TypedValueField } from '../../TypedValueField'
import { useAllEnvValueTypeGroups, type EnvValueTypeGroup } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { isPickableEntry } from '../../../utils/customValueEntries'
import { serializeValueForPersistence, type PersistedValue } from '../../../../../shared/utils/valuePersistence'

interface SwitchCase {
  id: string
  value: PersistedValue
}

/** Stable id for the default (not-yet-persisted) first case row shown on a
 * freshly-created switch, mirroring the object / input nodes' default row. */
const SWITCH_DEFAULT_CASE_ID = 'switch-default-case'

function caseId(): string {
  return `case-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** A persisted value of the same type as `prev`, advanced to the "next" value
 * where that's meaningful — for enum / customList the next allowed
 * label/value (or the first one if the prev was unset), for numeric the prev
 * incremented by 1. Used by "+" so a switch on a 5-value enum can be filled
 * by repeatedly clicking add. Returns a blank otherwise. */
function nextOfSameType(prev: PersistedValue, groups: EnvValueTypeGroup[]): PersistedValue {
  if (prev.type === 'enum') {
    for (const g of groups) {
      const def = g.enumDefinitions.find((d) => d.id === prev.enumDefinitionId)
      if (!def) continue
      const i = def.values.indexOf(prev.value)
      const next = i >= 0 && i < def.values.length - 1 ? def.values[i + 1] : (def.values[0] ?? '')
      return { type: 'enum', value: next ?? '', enumDefinitionId: prev.enumDefinitionId }
    }
    return blankOfSameType(prev)
  }
  if (prev.type === 'customList') {
    for (const g of groups) {
      const list = g.customValueLists.find((l) => l.id === prev.listId)
      if (!list) continue
      // Cycling steps through the choices a user could pick; an unnamed entry
      // would be a stop showing nothing on the branch.
      const pickable = list.entries.filter(isPickableEntry)
      const i = pickable.findIndex((e) => e.label === prev.label)
      const next = i >= 0 && i < pickable.length - 1 ? pickable[i + 1] : pickable[0]
      return { type: 'customList', listId: prev.listId, label: next?.label ?? '' }
    }
    return blankOfSameType(prev)
  }
  if (prev.type === 'numeric') {
    return { type: 'numeric', value: prev.value + 1, format: prev.format }
  }
  return blankOfSameType(prev)
}

/** A "blank" persisted value of the same type as `prev` — keeps the type's
 * structural metadata (`format`, `listId`, `enumDefinitionId`, …) so the new
 * case appears with the right control, but resets the user-entered content.
 * Called when "+" adds a case under an existing one, so the user doesn't have
 * to re-pick the type. */
function blankOfSameType(prev: PersistedValue): PersistedValue {
  switch (prev.type) {
    case 'numeric': return { type: 'numeric', value: 0, format: prev.format }
    case 'boolean': return { type: 'boolean', value: false }
    case 'datetime': return { type: 'datetime', value: new Date().toISOString(), format: prev.format }
    case 'color': return { type: 'color', value: '#000000' }
    case 'enum': return { type: 'enum', value: '', enumDefinitionId: prev.enumDefinitionId }
    case 'enumList': return { type: 'enumList', value: [], enumDefinitionId: prev.enumDefinitionId }
    case 'customList': return { type: 'customList', listId: prev.listId, label: '' }
    case 'customListMulti': return { type: 'customListMulti', listId: prev.listId, labels: [] }
    case 'secret': return { type: 'secret', source: prev.source, params: prev.params }
    case 'expression': return { type: 'expression', value: '' }
    case 'variable': return { type: 'variable', value: '' }
    case 'environment': return { type: 'environment', value: '' }
    case 'string':
    default: return { type: 'string', value: '' }
  }
}

/** Best-effort user-readable label for a case's typed value — feeds the
 * collapsed-handle tooltip. customList entries surface their picked label
 * ("Glaude"); strings/numbers/enums their printed value; the rest fall back
 * to a generic "case" so the tooltip never shows the raw case-id. */
function caseLabel(value: PersistedValue, t: TFunction): string {
  if (value.type === 'customList') return value.label || t('scenario.switch.case', 'case')
  if (value.type === 'customListMulti') return value.labels.join(', ') || t('scenario.switch.case', 'case')
  if (value.type === 'enum') return value.value || t('scenario.switch.case', 'case')
  if (value.type === 'enumList') return value.value.join(', ') || t('scenario.switch.case', 'case')
  if (value.type === 'string') return value.value || t('scenario.switch.case', 'case')
  if (value.type === 'numeric') return String(value.value)
  if (value.type === 'boolean') return String(value.value)
  if (value.type === 'datetime') return value.value || t('scenario.switch.case', 'case')
  return t('scenario.switch.case', 'case')
}

function readCases(config: Record<string, unknown>): SwitchCase[] {
  const raw = config['cases']
  if (!Array.isArray(raw)) return []
  return raw.filter((c): c is SwitchCase => typeof c === 'object' && c !== null && typeof (c as { id?: unknown }).id === 'string')
}

/**
 * `switch` node — routes the `on` value to the first matching case. The `on`
 * input is a typed-value selector (literal / variable, optional) that swaps to
 * the JSON-path selector when a link is connected; each case carries its own
 * value selector + a case output, and the type menu on a case offers
 * "Supprimer" to drop it. The "+" appends a case. Cases + `on` persist in the
 * node config; case outputs are rendered from the config (their signal flow is
 * derived). A header trigger lets an upstream `event` launch the switch.
 */
export const SwitchNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}
  const cases = readCases(config)
  // A fresh switch shows ONE ready-to-fill case row by default — NOT persisted
  // (so it doesn't trip the duplicate-value validation) until the user edits it.
  // Mirrors the object / input nodes.
  const displayCases: SwitchCase[] = cases.length > 0
    ? cases
    : [{ id: SWITCH_DEFAULT_CASE_ID, value: { type: 'string', value: '' } }]
  // Case ids flagged by a duplicate-value error → outline that case's value selector.
  const invalidCases = new Set(useScenarioNodeErrors(id).map((e) => e.field).filter((f): f is string => f != null))

  const setCases = (next: SwitchCase[]): void => { data.onSetConfig?.(id, { cases: next }) }

  const stop = (e: React.MouseEvent): void => { e.stopPropagation() }

  const left: ScenarioNodeSection[] = [
    {
      id: 'main',
      rows: [
        {
          id: 'on',
          label: 'on',
          port: { id: 'on', type: 'target' },
          content: (
            <div className="nodrag" onMouseDown={stop}>
              <TypedValueField
                value={normalizeValueType(config['on'])}
                onChange={(next) => { data.onSetConfig?.(id, { on: serializeValueForPersistence(next) }) }}
                valueTypeGroups={valueTypeGroups}
                excludeTypes={['expression']}
                allowEnvironment
                allowNull
                allowList
                dataTestId="scn-switch-on"
              />
            </div>
          )
        }
      ]
    }
  ]

  const right: ScenarioNodeCell[] = [
    ...displayCases.map((c): ScenarioNodeCell => ({
      id: c.id,
      // Carries the case's user-readable label onto the port — eg. the
      // customList entry name ("Glaude"), the literal string value, or the
      // formatted numeric — so the collapsed handle tooltip shows that
      // instead of the generated `case-…` id.
      label: caseLabel(c.value, t),
      content: (
        <div className={`nodrag${invalidCases.has(c.id) ? ' scn-field-invalid' : ''}`} onMouseDown={stop}>
          <TypedValueField
            value={normalizeValueType(c.value)}
            onChange={(next) => { setCases(displayCases.map((x) => (x.id === c.id ? { ...x, value: serializeValueForPersistence(next) } : x))) }}
            valueTypeGroups={valueTypeGroups}
            excludeTypes={['expression']}
            allowEnvironment
            allowNull
            allowList
            onRemove={() => { setCases(displayCases.filter((x) => x.id !== c.id)) }}
            removeLabel={t('scenario.switch.removeCase', 'Supprimer')}
            dataTestId={`scn-switch-${c.id}`}
          />
        </div>
      ),
      port: { id: c.id, role: 'case', type: 'source' }
    })),
    {
      id: 'add-case',
      content: (
        <Button
          small
          secondary
          icon="add"
          onClick={() => {
            // Inherit the previous case's type — and advance to the next enum
            // value / customList label / numeric+1 where that's meaningful —
            // so a switch on a 5-value enum can be filled by clicking `+` four
            // times. First case still defaults to `string` as the most
            // generic starting point.
            const last = displayCases[displayCases.length - 1]
            const seed = last ? nextOfSameType(last.value, valueTypeGroups) : { type: 'string' as const, value: '' }
            setCases([...displayCases, { id: caseId(), value: seed }])
          }}
          options={{ ariaLabel: t('scenario.switch.addCase', 'Add case') }}
          data-testid="scenario-switch-add-case"
        />
      )
    },
    { id: 'default', label: 'default', port: { id: 'default', role: 'default', type: 'source' } }
  ]

  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}

export default SwitchNodeBox
