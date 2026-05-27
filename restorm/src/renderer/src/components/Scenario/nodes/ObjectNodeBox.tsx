import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { Button } from 'electron-core-ui/renderer'
import { useTranslation } from 'react-i18next'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { ScenarioNameInput } from './ScenarioNameInput'
import { useScenarioNodeErrors } from '../scenarioErrorsContext'
import { TypedValueField } from '../../TypedValueField'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence, type PersistedValue } from '../../../../../shared/utils/valuePersistence'

interface ObjectProperty {
  id: string
  name: string
  value: PersistedValue
}

function propertyId(): string {
  return `prop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function readProperties(config: Record<string, unknown>): ObjectProperty[] {
  const raw = config['properties']
  if (!Array.isArray(raw)) return []
  return raw.filter((p): p is ObjectProperty => typeof p === 'object' && p !== null && typeof (p as { id?: unknown }).id === 'string')
}

/**
 * `object` — assembles a structured object from N user-configured properties
 * (the input-side analogue of the switch's cases). Each property carries a
 * name field + a connectable, unfiltered value selector (literal / variable /
 * wired); the assembled object is emitted on the single `object` output, ready
 * to feed an Output node, a Log, a Transform template, … The "+" adds a
 * property; each row's type menu offers "Supprimer". Properties persist in
 * config.
 */
export const ObjectNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}
  const properties = readProperties(config)
  // Property ids flagged by a validation error (missing / duplicate name) →
  // outline that property's name input red.
  const invalidProps = new Set(useScenarioNodeErrors(id).map((e) => e.field).filter((f): f is string => f != null))

  const setProperties = (next: ObjectProperty[]): void => { data.onSetConfig?.(id, { properties: next }) }
  const stop = (e: React.MouseEvent): void => { e.stopPropagation() }

  const rows: ScenarioNodeCell[] = properties.map((p): ScenarioNodeCell => ({
    id: p.id,
    port: { id: p.id, type: 'target' },
    content: (
      <div className="nodrag scn-object-property" onMouseDown={stop}>
        <ScenarioNameInput
          value={p.name}
          placeholder="property"
          invalid={invalidProps.has(p.id)}
          onCommit={(name) => { setProperties(properties.map((x) => (x.id === p.id ? { ...x, name } : x))) }}
        />
        <TypedValueField
          value={normalizeValueType(p.value)}
          onChange={(next) => { setProperties(properties.map((x) => (x.id === p.id ? { ...x, value: serializeValueForPersistence(next) } : x))) }}
          valueTypeGroups={valueTypeGroups}
          allowAllVariables
          onRemove={() => { setProperties(properties.filter((x) => x.id !== p.id)) }}
          removeLabel={t('scenario.object.removeProperty', 'Supprimer')}
          dataTestId={`scn-object-${p.id}`}
        />
      </div>
    )
  }))
  rows.push({
    id: 'add-property',
    content: (
      <Button
        small
        secondary
        icon="add"
        onClick={() => { setProperties([...properties, { id: propertyId(), name: '', value: { type: 'string', value: '' } }]) }}
        options={{ ariaLabel: t('scenario.object.addProperty', 'Add property'), title: t('scenario.object.addProperty', 'Add property') }}
        data-testid="scenario-object-add-property"
      />
    )
  })

  const left: ScenarioNodeSection[] = [{ id: 'main', rows }]
  const right: ScenarioNodeCell[] = [
    { id: 'object', label: 'object', port: { id: 'object', type: 'source' } }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={right} />
}

export default ObjectNodeBox
