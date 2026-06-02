import React from 'react'
import { useNodeConnections, type NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { Button } from 'electron-core-ui/renderer'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { ScenarioNameInput } from './ScenarioNameInput'
import { ScenarioPathSelector } from './ScenarioPathSelector'
import { useScenarioFieldInvalid, useScenarioNodeErrors } from '../scenarioErrorsContext'
import { readInputParams, INPUT_DEFAULT_PARAM_ID, type InputParam } from '../../../../../shared/scenarioInputParams'
import { readOutputDecls, OUTPUT_DEFAULT_DECL_ID, type OutputDecl } from '../../../../../shared/scenarioOutputDecls'
import { TypedValueField } from '../../TypedValueField'
import type { ValueTypeKind } from '../../TypedValueField/castValue'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence, type PersistedValue } from '../../../../../shared/utils/valuePersistence'
import { VariableValue } from '../../../../../shared/types/collections'

/** `getVariable` reads an existing variable: its selector is locked to the
 * `variable` kind (every other type excluded) and shows every variable
 * regardless of declared type. */
const VARIABLE_ONLY_EXCLUDE: ValueTypeKind[] = [
  'string', 'secret', 'number', 'dateTime', 'color', 'expression', 'boolean', 'enum', 'enumList', 'customList', 'customListMulti'
]

const VALUE_OUT: ScenarioNodeCell = { id: 'value', label: 'value', port: { id: 'value', type: 'source' } }

function paramId(): string {
  return `param-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * `input` — a named scenario parameter with a default typed value; produces
 * `value`. Runnable on its own, and chainable via the optional header launch
 * trigger. The name + the default value persist into the node's config bag.
 */
export const InputNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}
  const params = readInputParams(config)
  // A fresh / emptied input shows ONE ready-to-fill param row by default — NOT
  // persisted (so it doesn't trip the "must have a name" validation) until the
  // user types into it. Mirrors the object node.
  const displayParams: InputParam[] = params.length > 0
    ? params
    : [{ id: INPUT_DEFAULT_PARAM_ID, name: '', valueType: { type: 'string', value: '' } }]
  // A no-trigger input runs at the very start, before any variable is set, so a
  // default can't reference a variable → hide the Variables menu. With a
  // trigger it runs mid-flow, so variables are fair game EXCEPT a param's own
  // name (a param referencing itself is meaningless).
  const hasTrigger = useNodeConnections({ id, handleType: 'target', handleId: 'in' }).length > 0
  const invalidParams = new Set(useScenarioNodeErrors(id).map((e) => e.field).filter((f): f is string => f != null))
  const setParams = (next: InputParam[]): void => { data.onSetConfig?.(id, { params: next }) }

  const rows: ScenarioNodeCell[] = displayParams.map((p): ScenarioNodeCell => ({
    id: p.id,
    content: (
      <div className="nodrag scn-stacked-field" onMouseDown={(e) => { e.stopPropagation() }}>
        <span className="scn-port-label">{t('scenario.input.name', 'Name')}</span>
        <ScenarioNameInput
          value={p.name}
          placeholder="name"
          invalid={invalidParams.has(p.id)}
          onCommit={(next) => { setParams(displayParams.map((x) => (x.id === p.id ? { ...x, name: next } : x))) }}
        />
        <span className="scn-port-label">{t('scenario.input.defaultType', 'Default / type')}</span>
        <TypedValueField
          value={normalizeValueType(p.valueType)}
          onChange={(next) => { setParams(displayParams.map((x) => (x.id === p.id ? { ...x, valueType: serializeValueForPersistence(next) } : x))) }}
          valueTypeGroups={valueTypeGroups}
          excludeTypes={hasTrigger ? ['expression'] : ['expression', 'variable']}
          {...(hasTrigger ? { excludeVariableName: p.name } : {})}
          allowEnvironment
          onRemove={() => { setParams(displayParams.filter((x) => x.id !== p.id)) }}
          removeLabel={t('scenario.input.removeParam', 'Supprimer')}
          dataTestId={`scn-input-${p.id}`}
        />
      </div>
    )
  }))
  rows.push({
    id: 'add-param',
    content: (
      <Button
        small
        secondary
        icon="add"
        onClick={() => { setParams([...displayParams, { id: paramId(), name: '', valueType: { type: 'string', value: '' } }]) }}
        options={{ ariaLabel: t('scenario.input.addParam', 'Add parameter'), title: t('scenario.input.addParam', 'Add parameter') }}
        data-testid="scenario-input-add-param"
      />
    )
  })

  const left: ScenarioNodeSection[] = [{ id: 'main', rows }]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={[VALUE_OUT]} />
}

function declId(): string {
  return `out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** One declared output row — its own component so `useNodeConnections` can run
 * per port. Mirrors the `object` builder's property row: the NAME field is
 * always shown (so it survives wiring), and only the value sub-area swaps to the
 * JSON-path selector when an edge feeds the decl's `value` port. */
const OutputDeclRow: React.FC<{
  nodeId: string
  decl: OutputDecl
  nameInvalid: boolean
  scenarioId?: string | undefined
  canRemove: boolean
  onNameCommit: (name: string) => void
  onValueChange: (value: PersistedValue) => void
  onRemove: () => void
}> = ({ nodeId, decl, nameInvalid, scenarioId, canRemove, onNameCommit, onValueChange, onRemove }) => {
  const { t } = useTranslation()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const connections = useNodeConnections({ handleType: 'target', handleId: decl.id })
  const incoming = connections[0]
  const valueInvalid = useScenarioFieldInvalid(nodeId, decl.id)
  return (
    <div className="nodrag scn-object-property" onMouseDown={(e) => { e.stopPropagation() }}>
      <span className="scn-port-label scn-object-property-label">{t('scenario.output.outputName', 'Output name')}</span>
      <ScenarioNameInput
        value={decl.name}
        placeholder="output"
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
          value={normalizeValueType(decl.value)}
          onChange={(next) => { onValueChange(serializeValueForPersistence(next)) }}
          valueTypeGroups={valueTypeGroups}
          allowAllVariables
          allowEnvironment
          {...(canRemove ? { onRemove, removeLabel: t('scenario.output.removeOutput', 'Supprimer') } : {})}
          dataTestId={`scn-output-${decl.id}`}
        />
      )}
    </div>
  )
}

/**
 * `output` — declares ONE OR MORE named scenario outputs (the symmetric
 * counterpart of an `input` node's params). Each output has a name and its own
 * `value` input port; the value wired in (or a literal fallback) is exposed
 * under that name, which a parent `runScenario` derives into an `output:<name>`
 * port. Same row interface as the `object` builder — the name survives wiring,
 * only the value sub-area swaps to the JSON-path selector. A fresh / emptied
 * output shows one default row (not persisted until typed). Carries the header
 * `in` trigger (so it can be sequenced) but no `done` / `error` / output port
 * (see `scenarioNodeCapabilities`). Decls persist in config.
 */
export const OutputNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const config = data.config ?? {}
  const decls = readOutputDecls(config)
  const displayDecls: OutputDecl[] = decls.length > 0 ? decls : [{ id: OUTPUT_DEFAULT_DECL_ID, name: '' }]
  const invalidDecls = new Set(useScenarioNodeErrors(id).map((e) => e.field).filter((f): f is string => f != null))
  const setDecls = (next: OutputDecl[]): void => { data.onSetConfig?.(id, { outputs: next }) }

  const rows: ScenarioNodeCell[] = displayDecls.map((d): ScenarioNodeCell => ({
    id: d.id,
    label: d.name || t('scenario.output.outputName', 'Output name'),
    port: { id: d.id, type: 'target' },
    content: (
      <OutputDeclRow
        nodeId={id}
        decl={d}
        nameInvalid={invalidDecls.has(d.id)}
        {...(data.scenarioId !== undefined ? { scenarioId: data.scenarioId } : {})}
        canRemove={decls.length > 0}
        onNameCommit={(name) => { setDecls(displayDecls.map((x) => (x.id === d.id ? { ...x, name } : x))) }}
        onValueChange={(value) => { setDecls(displayDecls.map((x) => (x.id === d.id ? { ...x, value } : x))) }}
        onRemove={() => { setDecls(displayDecls.filter((x) => x.id !== d.id)) }}
      />
    )
  }))
  rows.push({
    id: 'add-output',
    content: (
      <Button
        small
        secondary
        icon="add"
        onClick={() => { setDecls([...displayDecls, { id: declId(), name: '' }]) }}
        options={{ ariaLabel: t('scenario.output.addOutput', 'Add output'), title: t('scenario.output.addOutput', 'Add output') }}
        data-testid="scenario-output-add-output"
      />
    )
  })

  const left: ScenarioNodeSection[] = [{ id: 'main', rows }]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={[]} />
}

/** `getVariable` — reads a named variable; produces `value`. Runnable (no input). */
/**
 * `getVariable` — reads a named variable; produces `value`. The variable is
 * chosen via a value selector locked to the `variable` kind (so the only choice
 * is picking an existing variable, of any type). A header trigger lets the read
 * be sequenced; it's also runnable on its own. The reference persists in config.
 */
export const GetVariableNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}
  const selectorInvalid = useScenarioFieldInvalid(id, 'value')
  const left: ScenarioNodeSection[] = [
    {
      id: 'main',
      rows: [
        {
          id: 'name',
          content: (
            <div className={`nodrag${selectorInvalid ? ' scn-field-invalid' : ''}`} onMouseDown={(e) => { e.stopPropagation() }}>
              <TypedValueField
                value={config['value'] !== undefined ? normalizeValueType(config['value']) : new VariableValue('')}
                onChange={(next) => { data.onSetConfig?.(id, { value: serializeValueForPersistence(next) }) }}
                valueTypeGroups={valueTypeGroups}
                excludeTypes={VARIABLE_ONLY_EXCLUDE}
                allowAllVariables
                allowEnvironment
                dataTestId="scn-getvar"
              />
            </div>
          )
        }
      ]
    }
  ]
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={[VALUE_OUT]} />
}

/**
 * `setVariable` — stores a value into a named variable, passing it through to
 * `out`. The value is a typed-value selector (literal value + type) when
 * unwired — so you can set a literal without a link, and the anchor stays
 * neutral rather than red/required — and {@link ScenarioInputCell} swaps it for
 * the JSON-path selector once a data link is connected. Name + value persist in
 * the node's config bag.
 */
export const SetVariableNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const config = data.config ?? {}
  const name = typeof config['name'] === 'string' ? config['name'] : ''
  const nameInvalid = useScenarioFieldInvalid(id, 'name')

  const left: ScenarioNodeSection[] = [
    {
      id: 'main',
      rows: [
        {
          id: 'name',
          content: (
            <ScenarioNameInput
              value={name}
              placeholder="variable"
              invalid={nameInvalid}
              onCommit={(next) => { data.onSetConfig?.(id, { name: next }) }}
            />
          )
        },
        {
          id: 'value',
          label: 'value',
          port: { id: 'value', type: 'target' },
          content: (
            <div className="nodrag" onMouseDown={(e) => { e.stopPropagation() }}>
              <TypedValueField
                value={normalizeValueType(config['value'])}
                onChange={(next) => { data.onSetConfig?.(id, { value: serializeValueForPersistence(next) }) }}
                valueTypeGroups={valueTypeGroups}
                excludeTypes={['expression']}
                excludeVariableName={name}
                allowEnvironment
                dataTestId="scn-setvar-value"
              />
            </div>
          )
        }
      ]
    }
  ]
  // No data `value` output: a setVariable stores its input into the named
  // variable (referenced elsewhere via the value selector's "Variables" menu).
  // A header `in` trigger sequences it; completion chains via the universal
  // `Done` port (which replaced the old redundant `event` signal).
  return <ScenarioNodeBoxBase id={id} data={data} selected={selected} left={left} right={[]} />
}
