import type { ScenarioNodeKind, ScenarioPort, ScenarioDataType, PortFlow, Scenario } from './types/collections'
import type { PortSpec, KindPorts } from './scenarioKindRegistry'
import { REGISTRY } from './scenarioKindRegistry'
import { readInputParams } from './scenarioInputParams'
import { readOutputDecls } from './scenarioOutputDecls'
import { acceptsInputEvent } from './scenarioNodeCapabilities'

// PortSpec / KindPorts moved to the kind registry (the single source of truth);
// re-exported here so existing importers of these shapes keep working.
export type { PortSpec, KindPorts } from './scenarioKindRegistry'

/**
 * Default input/output ports per node kind (epic §5b "per-kind
 * derivatives"). Port arity + roles are what visually distinguishes an
 * `If` (then/else) from a `Request` (response) from a `ForEach`
 * (each/done) — the shared NodeBox renders whatever ports a node carries,
 * so the kind specialisation lives in data here rather than in 21
 * component subclasses. The error port is implicit (the NodeBox always
 * draws it) and is never listed here.
 *
 * Lives in `shared` so both the renderer editor and the main-process MCP
 * tools stamp the same ports when a node is created.
 *
 * Each port carries a `flow` class (value / signal / both) used to validate
 * links — see {@link isValidScenarioConnection}. Inputs without a `flow`
 * default to `value` (data/body inputs that accept A/AB); the header launch
 * trigger is `signal` (accepts B/AB).
 */

function p(spec: PortSpec): ScenarioPort {
  return {
    id: spec.id,
    name: spec.name ?? '',
    dataType: spec.dataType ?? 'any',
    ...(spec.role ? { role: spec.role } : {}),
    ...(spec.required ? { required: true } : {}),
    ...(spec.flow ? { flow: spec.flow } : {})
  }
}

/** Generic header launch trigger — a `signal` input (accepts B/AB). Stamped
 * centrally by {@link defaultPortsForKind} for every kind that
 * {@link acceptsInputEvent}, so it is NOT carried in the registry's per-kind
 * port specs. */
const IN: PortSpec = { id: 'in', flow: 'signal' }

/** Fresh default ports for a node of the given kind (new arrays each call). The
 * per-kind static ports come from the kind registry (the single source of
 * truth); the header `in` launch trigger is prepended for every kind that
 * {@link acceptsInputEvent} — i.e. all but the `output` sink. */
export function defaultPortsForKind(kind: ScenarioNodeKind): { inputs: ScenarioPort[]; outputs: ScenarioPort[] } {
  const spec: KindPorts = REGISTRY[kind].ports
  const inputs = acceptsInputEvent(kind) ? [IN, ...spec.inputs] : spec.inputs
  return { inputs: inputs.map(p), outputs: spec.outputs.map(p) }
}

/** The listened event names of a `socketioConnect` node, read from
 * `config.events` (a string[]). Empty/garbage → no events. Duplicates and
 * blanks are dropped so each event maps to exactly one port. */
export function readSocketioEvents(config: Record<string, unknown> | undefined): string[] {
  const raw = config?.['events']
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const e of raw) {
    if (typeof e !== 'string') continue
    const name = e.trim()
    if (name === '' || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

/** Derived output ports for a `socketioConnect` node's listened events — one
 * `event:<name>` port per entry in `config.events` (switch-like, like the
 * switch's `case-…` ports). The static `connected` / `others` ports come from
 * {@link defaultPortsForKind}; these are added on top by the editor render and
 * the MCP authoring path (so a link can target a specific event). */
export function socketioConnectEventPorts(config: Record<string, unknown> | undefined): ScenarioPort[] {
  return readSocketioEvents(config).map((name) => p({ id: `event:${name}`, name, dataType: 'any', flow: 'both' }))
}

/** Map a persisted value-type kind (an `input` node's `valueType`) to a port
 * `dataType` for palette filtering. Laxiste — unknowns fall back to `any`. */
function dataTypeForValueType(value: unknown): ScenarioDataType {
  const t = (value as { type?: unknown } | null | undefined)?.type
  if (t === 'number' || t === 'numeric') return 'number'
  if (t === 'string') return 'string'
  if (t === 'boolean') return 'boolean'
  return 'any'
}

/**
 * Ports a `runScenario` node exposes for a given sub-scenario, **derived from
 * the reference** (epic §5b): one input port per named `input` node (id
 * `param:<name>`, dataType from its `valueType`) and one output port per named
 * `output` node (id `output:<name>`). Re-derived on demand (never persisted),
 * so the call signature always tracks the live sub-scenario — a renamed/removed
 * param simply drops its port (orphaning any edge to it). Unnamed nodes can't be
 * exposed; duplicate names collapse to the first. Shared so the editor render
 * and the MCP authoring path agree on the exact port ids.
 */
export function deriveRunScenarioPorts(subScenario: Scenario | null | undefined): { inputs: ScenarioPort[]; outputs: ScenarioPort[] } {
  const inputs: ScenarioPort[] = []
  const outputs: ScenarioPort[] = []
  if (!subScenario) return { inputs, outputs }
  // An `input` node that is the target of an edge is fed from inside the
  // sub-scenario (its `in` trigger — its only input port — is wired to a
  // predecessor), so its value is produced internally. It is NOT a parameter
  // the caller supplies, so it must not surface as a `param:` port. Only the
  // FREE input nodes (no incoming edge) are the scenario's call parameters.
  const internallyDrivenNodeIds = new Set<string>()
  for (const edge of subScenario.edges) internallyDrivenNodeIds.add(edge.to.nodeId)
  const seenIn = new Set<string>()
  const seenOut = new Set<string>()
  // Count the distinct source nodes that actually contribute a port. When a
  // column draws from MORE THAN ONE source the per-source authoring order is
  // meaningless to the caller, so we sort it alphabetically (below); a single
  // source keeps its own declaration order.
  let inputSources = 0
  let outputSources = 0
  for (const node of subScenario.nodes) {
    // An input node now declares MANY params — one `param:<name>` port each.
    if (node.kind === 'input') {
      // Skip internally-driven inputs (wired from a predecessor) — not caller params.
      if (internallyDrivenNodeIds.has(node.id)) continue
      let contributed = false
      for (const param of readInputParams(node.config)) {
        const name = param.name.trim()
        if (!name || seenIn.has(name)) continue
        seenIn.add(name)
        contributed = true
        inputs.push(p({ id: `param:${name}`, name, dataType: dataTypeForValueType(param.valueType), flow: 'value' }))
      }
      if (contributed) inputSources += 1
      continue
    }
    // An output node now declares MANY outputs — one `output:<name>` port each.
    if (node.kind === 'output') {
      let contributed = false
      for (const decl of readOutputDecls(node.config)) {
        const name = decl.name.trim()
        if (!name || seenOut.has(name)) continue
        seenOut.add(name)
        contributed = true
        outputs.push(p({ id: `output:${name}`, name, role: 'response', flow: 'both' }))
      }
      if (contributed) outputSources += 1
    }
  }
  // Multiple sources → sort alphabetically by port name so the column has a
  // stable, predictable order independent of node/authoring order.
  if (inputSources > 1) inputs.sort((a, b) => a.name.localeCompare(b.name))
  if (outputSources > 1) outputs.sort((a, b) => a.name.localeCompare(b.name))
  // A sub-scenario that returns no data exposes NO derived output port: every
  // box already carries the universal `done` completion port (drawn by the box
  // chrome), which a parent uses to sequence the next node. An explicit `done`
  // port here would just duplicate that same `done` handle id and intercept its
  // connections.
  return { inputs, outputs }
}

// --- Link validation by port flow class -----------------------------------

/** Can an output of `outputFlow` feed an input that accepts `inputAccepts`?
 *
 * The ONLY forbidden combination is a pure-SIGNAL output into a pure-DATA
 * input: a signal carries no value, so it can't populate an operand. Every
 * other pairing connects — a data (or `both`) output also acts as a trigger
 * (so it can feed a signal `in`), and a `both` input accepts either. */
export function canConnectFlow(outputFlow: PortFlow, inputAccepts: PortFlow): boolean {
  return !(outputFlow === 'signal' && inputAccepts === 'value')
}

/** Flow of a source output handle. The implicit `error` port is `both` and the
 * implicit `done` completion port is `signal` (both drawn on every box, never
 * listed per-kind). Every other generic output carries a value AND acts as a
 * trigger → `both`; the SOLE exceptions are the while/doWhile body (`then`),
 * a pure SIGNAL that fires the loop body without carrying a per-iteration
 * value. */
export function outputPortFlow(outputs: ScenarioPort[], handleId: string, kind: ScenarioNodeKind): PortFlow {
  if (handleId === 'error') return 'both'
  if (handleId === 'done') return 'signal'
  const port = outputs.find((o) => o.id === handleId)
  if (port?.flow) return port.flow
  // Flow-less (legacy) ports: the while/doWhile body is a pure signal; every
  // other output carries data + triggers → `both`.
  if ((kind === 'while' || kind === 'doWhile') && port?.role === 'then') return 'signal'
  return 'both'
}

/** What a target input handle accepts (defaults to `value`/data input). The
 * header launch trigger (`in`, except on a switch where it's the data input)
 * accepts `signal` — derived here for inputs stamped before `flow` existed. */
export function inputPortFlow(inputs: ScenarioPort[], handleId: string, kind?: ScenarioNodeKind): PortFlow {
  const port = inputs.find((i) => i.id === handleId)
  if (port?.flow) return port.flow
  if (handleId === 'in' && kind !== 'switch') return 'signal'
  return 'value'
}

/** Whether a value of declared type `out` can flow into an input declaring
 * `inp`. `any` on either side is the universal wildcard. `json` is the
 * ambiguous collection/value type, so it is treated as compatible with a
 * concrete `list` (an array IS json) — this lets a json/response source still
 * feed a list-only target while a plain `object` (a distinct type) cannot. */
export function dataTypesCompatible(out: ScenarioDataType, inp: ScenarioDataType): boolean {
  if (out === 'any' || inp === 'any' || out === inp) return true
  if ((out === 'json' && inp === 'list') || (out === 'list' && inp === 'json')) return true
  return false
}

/** The CANONICAL dataType of a kind's static output port — fresh from
 * {@link defaultPortsForKind}, so a node persisted before a port's dataType
 * changed (e.g. an `object` output stamped `json` before it became `object`)
 * still resolves by the CURRENT type. Falls back to the passed port (dynamic
 * ports like runScenario's `output:<name>` aren't in the static defaults). */
export function canonicalOutputType(kind: ScenarioNodeKind, outputs: ScenarioPort[], handleId: string): ScenarioDataType {
  return defaultPortsForKind(kind).outputs.find((p) => p.id === handleId)?.dataType
    ?? outputs.find((p) => p.id === handleId)?.dataType ?? 'any'
}

/** The CANONICAL dataType of a kind's static input port (see
 * {@link canonicalOutputType}). Falls back to the passed port for dynamic
 * inputs (object properties, list-mutation value rows, runScenario params). */
export function canonicalInputType(kind: ScenarioNodeKind, inputs: ScenarioPort[], handleId: string): ScenarioDataType {
  return defaultPortsForKind(kind).inputs.find((p) => p.id === handleId)?.dataType
    ?? inputs.find((p) => p.id === handleId)?.dataType ?? 'any'
}

/** Validate a scenario edge. Primary gate is the port flow class (value /
 * signal / both). On top of that, a list-only target (`dataType: 'list'` — the
 * AddToList/RemoveFromList `list` slot) refuses a source whose type isn't
 * list-compatible (so a plain `object` can't be wired as the list target,
 * while a list / json / variable source still can). */
export function isValidScenarioConnection(args: {
  sourceKind: ScenarioNodeKind
  sourceOutputs: ScenarioPort[]
  sourceHandle: string
  targetKind: ScenarioNodeKind
  targetInputs: ScenarioPort[]
  targetHandle: string
}): boolean {
  // Resolve dataTypes canonically (fresh from the kind's defaults) so a node
  // persisted before a port's type changed — e.g. an old `object` output stamped
  // `json`, or an old AddToList `list` port stamped `json` — still validates by
  // the current type instead of the stale stamp.
  const targetType = canonicalInputType(args.targetKind, args.targetInputs, args.targetHandle)
  if (targetType === 'list') {
    const sourceType = canonicalOutputType(args.sourceKind, args.sourceOutputs, args.sourceHandle)
    if (!dataTypesCompatible(sourceType, 'list')) return false
  }
  return canConnectFlow(
    outputPortFlow(args.sourceOutputs, args.sourceHandle, args.sourceKind),
    inputPortFlow(args.targetInputs, args.targetHandle, args.targetKind)
  )
}
