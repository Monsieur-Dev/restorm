import React from 'react'
import { type NodeProps, useNodeConnections } from '@xyflow/react'
import { Button } from 'electron-core-ui/renderer'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { ScenarioNameInput } from './ScenarioNameInput'
import { ScenarioPathSelector } from './ScenarioPathSelector'
import { useScenarioNodeErrors, useScenarioFieldInvalid } from '../scenarioErrorsContext'
import { TypedValueField } from '../../TypedValueField'
import { useAllEnvValueTypeGroups, type EnvValueTypeGroup } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence, type PersistedValue } from '../../../../../shared/utils/valuePersistence'
import { OBJECT_DEFAULT_PROPERTY_ID } from '../../../../../shared/scenarioObjectProps'

interface ObjectProperty {
  id: string
  name: string
  value: PersistedValue
}

function propertyId(): string {
  return `prop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** Stable id for the default (not-yet-persisted) first row shown on an empty
 * object, so React keeps its input state across renders until the user types.
 * Shared with the validator so it can flag this exact row red. */
const OBJECT_DEFAULT_ROW_ID = OBJECT_DEFAULT_PROPERTY_ID

function readProperties(config: Record<string, unknown>): ObjectProperty[] {
  const raw = config['properties']
  if (!Array.isArray(raw)) return []
  return raw.filter((p): p is ObjectProperty => typeof p === 'object' && p !== null && typeof (p as { id?: unknown }).id === 'string')
}

/** A single property row inside the object builder — needs its own component
 * so `useNodeConnections` (a React hook) can run per port: when an upstream
 * edge feeds this property, the value cell swaps from the literal selector to
 * the JSON-path selector (same affordance as the rest of the data inputs). */
interface ObjectPropertyRowProps {
  nodeId: string
  property: ObjectProperty
  nameInvalid: boolean
  scenarioId?: string | undefined
  valueTypeGroups: EnvValueTypeGroup[]
  t: TFunction
  onNameCommit: (name: string) => void
  onValueChange: (value: PersistedValue) => void
  onRemove: () => void
  removeLabel: string
  dataTestId: string
}

const ObjectPropertyRow: React.FC<ObjectPropertyRowProps> = ({
  nodeId,
  property,
  nameInvalid,
  scenarioId,
  valueTypeGroups,
  t,
  onNameCommit,
  onValueChange,
  onRemove,
  removeLabel,
  dataTestId
}) => {
  const connections = useNodeConnections({ handleType: 'target', handleId: property.id })
  const incoming = connections[0]
  const valueInvalid = useScenarioFieldInvalid(nodeId, property.id)
  const stop = (e: React.MouseEvent): void => { e.stopPropagation() }
  return (
    <div className="nodrag scn-object-property" onMouseDown={stop}>
      <span className="scn-port-label scn-object-property-label">{t('scenario.object.propertyName', 'Property name')}</span>
      <ScenarioNameInput
        value={property.name}
        placeholder="property"
        invalid={nameInvalid}
        onCommit={onNameCommit}
      />
      <span className="scn-port-label scn-object-property-label">{t('scenario.object.propertyValue', 'value')}</span>
      {incoming ? (
        <ScenarioPathSelector
          edgeId={incoming.edgeId}
          sourceNodeId={incoming.source}
          invalid={valueInvalid}
          {...(scenarioId !== undefined ? { scenarioId } : {})}
        />
      ) : (
        <TypedValueField
          value={normalizeValueType(property.value)}
          onChange={(next) => { onValueChange(serializeValueForPersistence(next)) }}
          valueTypeGroups={valueTypeGroups}
          allowAllVariables
          allowEnvironment
          allowNull
          allowList
          onRemove={onRemove}
          removeLabel={removeLabel}
          dataTestId={dataTestId}
        />
      )}
    </div>
  )
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
  // A fresh / emptied object shows ONE ready-to-fill row by default. It is NOT
  // persisted (so an empty object stays `{}` and doesn't trip the
  // "property must have a name" validation) — it materialises into config only
  // once the user types into it, via the row handlers below.
  const displayProperties: ObjectProperty[] = properties.length > 0
    ? properties
    : [{ id: OBJECT_DEFAULT_ROW_ID, name: '', value: { type: 'string', value: '' } }]
  // Property ids flagged by a validation error (missing / duplicate name) →
  // outline that property's name input red.
  const invalidProps = new Set(useScenarioNodeErrors(id).map((e) => e.field).filter((f): f is string => f != null))

  const setProperties = (next: ObjectProperty[]): void => { data.onSetConfig?.(id, { properties: next }) }

  const rows: ScenarioNodeCell[] = displayProperties.map((p): ScenarioNodeCell => ({
    id: p.id,
    // Carries the user-given property name onto the port so the collapsed
    // box tooltip shows "started_at" / "total_seconds" instead of the
    // generated `prop-…` handle id.
    label: p.name || t('scenario.object.propertyName', 'Property name'),
    port: { id: p.id, type: 'target' },
    content: (
      <ObjectPropertyRow
        nodeId={id}
        property={p}
        nameInvalid={invalidProps.has(p.id)}
        {...(data.scenarioId !== undefined ? { scenarioId: data.scenarioId } : {})}
        valueTypeGroups={valueTypeGroups}
        t={t}
        onNameCommit={(name) => { setProperties(displayProperties.map((x) => (x.id === p.id ? { ...x, name } : x))) }}
        onValueChange={(value) => { setProperties(displayProperties.map((x) => (x.id === p.id ? { ...x, value } : x))) }}
        onRemove={() => { setProperties(displayProperties.filter((x) => x.id !== p.id)) }}
        removeLabel={t('scenario.object.removeProperty', 'Supprimer')}
        dataTestId={`scn-object-${p.id}`}
      />
    )
  }))
  rows.push({
    id: 'add-property',
    content: (
      <Button
        small
        secondary
        icon="add"
        onClick={() => { setProperties([...displayProperties, { id: propertyId(), name: '', value: { type: 'string', value: '' } }]) }}
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
