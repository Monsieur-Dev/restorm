import React, { useMemo } from 'react'
import { useNodeConnections, type NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import { isScenario } from '../../../../../shared/types/collections'
import { Badge } from '../../common/Badge'
import { useScenarioBoundResolver } from '../scenarioBoundResolver'
import { ScenarioNodeBoxBase, type ScenarioNodeBoxType, type ScenarioNodeCell, type ScenarioNodeSection } from './ScenarioNodeBoxBase'
import { deriveRunScenarioPorts } from '../../../../../shared/scenarioNodePorts'
import { readInputParams } from '../../../../../shared/scenarioInputParams'
import { TypedValueField } from '../../TypedValueField'
import { resolveValueTypeKind, type ValueTypeKind } from '../../TypedValueField/castValue'
import { useAllEnvValueTypeGroups } from '../../../hooks/useAllEnvValueTypeGroups'
import { normalizeValueType } from '../../../utils/normalizeValueType'
import { serializeValueForPersistence } from '../../../../../shared/utils/valuePersistence'

/** The literal value kinds (variable / environment are gated by the dedicated
 * props, not `excludeTypes`). Bounding a field to ONE kind excludes the rest. */
const LITERAL_VALUE_KINDS: ValueTypeKind[] = ['string', 'secret', 'number', 'dateTime', 'color', 'expression', 'boolean', 'enum', 'enumList', 'customList', 'customListMulti']

/** Lock a value field to a single declared kind — exclude every other literal,
 * and only enable the variable / environment menus when that IS the kind. */
function boundFieldProps(kind: ValueTypeKind): { excludeTypes: ValueTypeKind[]; allowEnvironment: boolean; allowAllVariables: boolean } {
  return {
    excludeTypes: LITERAL_VALUE_KINDS.filter((k) => k !== kind),
    allowEnvironment: kind === 'environment',
    allowAllVariables: kind === 'variable'
  }
}

/** Stale-port label: a warning glyph + the vanished param/output name. */
const OrphanLabel: React.FC<{ name: string; title: string }> = ({ name, title }) => (
  <span className="scn-orphan-port" title={title}>
    <i className="codicon codicon-warning" aria-hidden="true" />
    {name}
  </span>
)

/** Distinct connected handle ids (target or source) on this node. */
function useConnectedHandles(id: string, handleType: 'target' | 'source'): Set<string> {
  const conns = useNodeConnections({ id, handleType })
  return useMemo(
    () => new Set(conns.map((c) => (handleType === 'target' ? c.targetHandle : c.sourceHandle)).filter((h): h is string => h != null)),
    [conns, handleType]
  )
}

/**
 * `runScenario` node — runs a sub-scenario bound by id (`config.scenarioId`),
 * invoked like a function. Its header shows the SCENARIO badge + the live
 * scenario name (a rename follows here); `config.label` is a fallback when the
 * scenario is deleted. Its ports are **derived from the reference**: one input
 * port per named `input` node of the sub-scenario and one output port per named
 * `output` node, so the call signature tracks the sub-scenario's params +
 * outputs. The header launch trigger (`in`) sequences the call.
 */
export const RunScenarioNodeBox: React.FC<NodeProps<ScenarioNodeBoxType>> = ({ id, data, selected }) => {
  const { t } = useTranslation()
  const resolve = useScenarioBoundResolver()
  const valueTypeGroups = useAllEnvValueTypeGroups()
  const scenarioId = typeof data.config?.['scenarioId'] === 'string' ? data.config['scenarioId'] : undefined
  const item = scenarioId && resolve ? resolve(scenarioId) : null
  const scenario = item && isScenario(item) ? item : null

  // Each sub-scenario param's declared typed-value (by name), so a call-site
  // input can offer a value editor bounded to that exact type (an Environment
  // param → the env picker, a colour param → the colour picker, …). Inline
  // values entered here persist under `config.paramValues[<name>]`.
  const paramTypeByName = useMemo(() => {
    const m = new Map<string, unknown>()
    if (scenario) {
      for (const node of scenario.nodes) {
        if (node.kind !== 'input') continue
        for (const p of readInputParams(node.config)) {
          const name = p.name.trim()
          if (name && !m.has(name)) m.set(name, p.valueType)
        }
      }
    }
    return m
  }, [scenario])
  const paramValues = (data.config?.['paramValues'] as Record<string, unknown> | undefined) ?? {}

  const fallbackLabel = typeof data.config?.['label'] === 'string' ? data.config['label'] : undefined
  const title = scenario?.name ?? fallbackLabel
  const headerIcon = scenario ? <Badge type="SCENARIO" /> : undefined

  // Ports derived from the sub-scenario's input / output nodes (shared with the
  // MCP authoring path, so both agree on the exact port ids). Memoised so an
  // unrelated re-render doesn't rebuild the port arrays (a box with many params
  // re-measures + tells React Flow to recompute handles on every change).
  const derived = useMemo(() => deriveRunScenarioPorts(scenario), [scenario])

  // Incoming / outgoing links whose derived port has since vanished (a param
  // renamed or deleted in the sub-scenario). React Flow drops an edge with no
  // matching handle, so we re-render a red "stale port" stub to keep the edge
  // visible (drawn red + dashed by the editor) and name the broken wiring.
  const connectedTargets = useConnectedHandles(id, 'target')
  const connectedSources = useConnectedHandles(id, 'source')
  const derivedInIds = new Set(derived.inputs.map((p) => p.id))
  const derivedOutIds = new Set(derived.outputs.map((p) => p.id))
  const orphanInIds = [...connectedTargets].filter((h) => h.startsWith('param:') && !derivedInIds.has(h))
  const orphanOutIds = [...connectedSources].filter((h) => h.startsWith('output:') && !derivedOutIds.has(h))

  const rows: ScenarioNodeCell[] = []
  // First body line: a link to open the bound sub-scenario in a workbench tab.
  if (scenario && scenarioId && data.onOpenItem) {
    rows.push({
      id: 'edit',
      content: (
        <button
          type="button"
          className="scn-edit-link nodrag"
          data-testid="scn-runscenario-edit-link"
          onClick={(e) => { e.stopPropagation(); data.onOpenItem?.(scenarioId) }}
        >
          {t('scenario.editScenario', 'Edit scenario')}
        </button>
      )
    })
  }
  // One input port per named `input` node of the sub-scenario. Unwired, it
  // offers an inline value editor bounded to the param's declared type; wiring
  // a data link swaps it for the JSON-path selector (via {@link ScenarioInputCell}).
  for (const port of derived.inputs) {
    const name = port.name
    const value = normalizeValueType(paramValues[name] ?? paramTypeByName.get(name))
    const bound = boundFieldProps(resolveValueTypeKind(value))
    rows.push({
      id: port.id,
      label: port.name,
      port: { id: port.id, type: 'target', ...(port.required ? { required: true } : {}), ...(port.flow ? { flow: port.flow } : {}) },
      content: (
        <div className="nodrag scn-stacked-field" onMouseDown={(e) => { e.stopPropagation() }}>
          <span className="scn-port-label">{port.name}</span>
          <TypedValueField
            value={value}
            onChange={(next) => { data.onSetConfig?.(id, { paramValues: { ...paramValues, [name]: serializeValueForPersistence(next) } }) }}
            valueTypeGroups={valueTypeGroups}
            excludeTypes={bound.excludeTypes}
            {...(bound.allowEnvironment ? { allowEnvironment: true } : {})}
            {...(bound.allowAllVariables ? { allowAllVariables: true } : {})}
            dataTestId={`scn-runscenario-${name}`}
          />
        </div>
      )
    })
  }
  // Stale incoming param ports (red), so the orphaned edge keeps an anchor.
  for (const handleId of orphanInIds) {
    const name = handleId.slice('param:'.length)
    rows.push({
      id: handleId,
      content: <OrphanLabel name={name} title={t('scenario.runScenario.orphanInput', 'No matching parameter "{{name}}" in the sub-scenario', { name })} />,
      port: { id: handleId, type: 'target', orphan: true }
    })
  }
  const left: ScenarioNodeSection[] = rows.length > 0 ? [{ id: 'main', rows }] : []

  // One output port per named `output` node of the sub-scenario — or, when the
  // sub-scenario returns nothing, a single `done` completion trigger ("Ensuite").
  const right: ScenarioNodeCell[] = derived.outputs.map((port) => ({
    id: port.id,
    label: port.id === 'done' ? t('scenario.runScenario.then', 'Then') : port.name,
    port: { id: port.id, ...(port.role ? { role: port.role } : {}), type: 'source', ...(port.flow ? { flow: port.flow } : {}) }
  }))
  // Stale outgoing output ports (red), keeping their orphaned edge anchored.
  for (const handleId of orphanOutIds) {
    const name = handleId.slice('output:'.length)
    right.push({
      id: handleId,
      content: <OrphanLabel name={name} title={t('scenario.runScenario.orphanOutput', 'No matching output "{{name}}" in the sub-scenario', { name })} />,
      port: { id: handleId, type: 'source', orphan: true }
    })
  }
  return (
    <ScenarioNodeBoxBase
      id={id}
      data={data}
      selected={selected}
      left={left}
      right={right}
      launchInput
      {...(headerIcon ? { headerIcon } : {})}
      {...(title ? { title } : {})}
    />
  )
}

export default RunScenarioNodeBox
