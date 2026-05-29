import type { ScenarioNodeKind, ScenarioPort, ScenarioDataType, ScenarioPortRole, PortFlow, Scenario } from './types/collections'

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

interface PortSpec {
  id: string
  name?: string
  dataType?: ScenarioDataType
  role?: ScenarioPortRole
  required?: boolean
  flow?: PortFlow
}

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

interface KindPorts {
  inputs: PortSpec[]
  outputs: PortSpec[]
}

/** Generic header launch trigger — a `signal` input (accepts B/AB). */
const IN: PortSpec = { id: 'in', flow: 'signal' }
/** Generic "done" output — a `signal` (B). */
const OUT: PortSpec = { id: 'out', flow: 'signal' }

const PORTS: Partial<Record<ScenarioNodeKind, KindPorts>> = {
  // Sources & control
  input: { inputs: [IN], outputs: [{ id: 'value', name: 'value', flow: 'value' }] },
  // `output` — declares a named scenario output (the symmetric counterpart of
  // `input`): it consumes a `value` and exposes it as one of the scenario's
  // outputs, which a parent `runScenario` derives into an output port. A
  // terminal sink — no output of its own.
  output: { inputs: [{ id: 'value', name: 'value' }], outputs: [] },
  if: { inputs: [IN, { id: 'left', name: 'left' }, { id: 'right', name: 'right' }], outputs: [{ id: 'then', name: 'then', role: 'then', flow: 'signal' }, { id: 'else', name: 'else', role: 'else', flow: 'signal' }] },
  switch: { inputs: [IN, { id: 'on', name: 'on' }], outputs: [{ id: 'default', name: 'default', role: 'default', flow: 'signal' }] },
  // Requests & composition
  httpRequest: { inputs: [IN, { id: 'env', name: 'env', flow: 'value' }], outputs: [{ id: 'response', name: 'response', dataType: 'response', role: 'response', flow: 'both' }] },
  runScenario: { inputs: [IN], outputs: [{ id: 'result', name: 'result', role: 'response', flow: 'both' }] },
  // Iteration & collections. `items` carries a value-selector fallback in the
  // editor (list-typed sources), so it isn't a hard-required port — like the
  // `if` operands; the editor flags it red only when no list type is available.
  // No header trigger — collection nodes are data-driven (run once `items`
  // resolves).
  forEach: { inputs: [{ id: 'items', name: 'items', dataType: 'json' }], outputs: [{ id: 'each', name: 'each', role: 'then', flow: 'both' }, { id: 'done', name: 'done', role: 'else', flow: 'signal' }] },
  // `items` has a value-selector fallback in the editor (like forEach), so it
  // isn't a hard-required port; the editor flags it red only when no list type
  // is available to pick. No header trigger — a reduce is data-driven (it runs
  // once its inputs resolve and exposes `result`).
  aggregate: { inputs: [{ id: 'items', name: 'items', dataType: 'json' }], outputs: [{ id: 'result', name: 'result', flow: 'value' }] },
  // `items` has a value-selector fallback (like forEach); the per-item
  // transform lives in config. No header trigger — data-driven.
  map: { inputs: [{ id: 'items', name: 'items', dataType: 'json' }], outputs: [{ id: 'mapped', name: 'mapped', dataType: 'json', flow: 'value' }] },
  // `items` has a value-selector fallback in the editor (like forEach), so it
  // isn't a hard-required port; the predicate (field/operator/value) lives in
  // config. No header trigger — data-driven (runs once `items` resolves).
  filter: { inputs: [{ id: 'items', name: 'items', dataType: 'json' }], outputs: [{ id: 'kept', name: 'kept', dataType: 'json', flow: 'value' }] },
  // Time
  wait: { inputs: [IN, { id: 'duration', name: 'duration', dataType: 'duration' }], outputs: [{ id: 'out', name: 'then', role: 'then', flow: 'signal' }] },
  // Aligned on `wait`: a header trigger + an inline value fallback (a date-time
  // picker) on `until`, so it isn't a hard-required port and the node is
  // runnable on its own.
  waitUntil: { inputs: [IN, { id: 'until', name: 'until' }], outputs: [{ id: 'out', name: 'then', role: 'then', flow: 'signal' }] },
  now: { inputs: [IN], outputs: [{ id: 'value', name: 'now', dataType: 'string', flow: 'value' }] },
  // Data & compute. Operands carry typed value-selector fallbacks (like `if`),
  // so they aren't hard-required ports. No header trigger — these are pure
  // value nodes (data-driven: they run once their inputs resolve and expose
  // `result`), so they don't need a launch signal to sequence them.
  arithmetic: { inputs: [{ id: 'a', name: 'a', dataType: 'number' }, { id: 'b', name: 'b', dataType: 'number' }], outputs: [{ id: 'result', name: 'result', dataType: 'number', flow: 'value' }] },
  comparator: { inputs: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }], outputs: [{ id: 'result', name: 'result', dataType: 'boolean', flow: 'value' }] },
  // `object` builds a structured object from N named properties. The property
  // inputs are user-configured (rendered from config like the switch cases), so
  // none are stamped here; the single output is the assembled JSON object. No
  // header trigger — data-driven (runs once its property inputs resolve).
  object: { inputs: [], outputs: [{ id: 'object', name: 'object', dataType: 'json', flow: 'value' }] },
  boolean: { inputs: [{ id: 'a', name: 'a', dataType: 'boolean' }, { id: 'b', name: 'b', dataType: 'boolean' }], outputs: [{ id: 'result', name: 'result', dataType: 'boolean', flow: 'value' }] },
  setVariable: { inputs: [{ id: 'value', name: 'value' }], outputs: [{ id: 'event', name: 'event', flow: 'signal' }] },
  getVariable: { inputs: [IN], outputs: [{ id: 'value', name: 'value', flow: 'value' }] },
  // `transform` (a.k.a. "Transform template") applies an expression/Handlebars
  // template to its optional `value` input and emits the result. The input is
  // optional so the node runs on its own (a pure template); the expression
  // determines the output type.
  transform: { inputs: [{ id: 'value', name: 'value' }], outputs: [{ id: 'out', name: 'value', flow: 'value' }] },
  // Utilities
  // A terminal sink: a header launch trigger (`in`) so it can be sequenced in
  // a flow, plus two optional inputs (wire either, or set inline). `message` is
  // a string, `data` any value. No output (terminal).
  log: { inputs: [IN, { id: 'message', name: 'message', dataType: 'string' }, { id: 'data', name: 'data' }], outputs: [] },
  // An assertion compares two operands (`actual` / `expected`) with the same
  // operator toggle as `if`/`comparator`; both operands carry inline
  // value-selector fallbacks, so they aren't hard-required ports. A header
  // trigger sequences it like an `if`. Branches `pass` / `fail`; the failure
  // label lives in config (`message`).
  assert: { inputs: [IN, { id: 'a', name: 'actual' }, { id: 'b', name: 'expected' }], outputs: [{ id: 'then', name: 'pass', role: 'then', flow: 'signal' }, { id: 'else', name: 'fail', role: 'else', flow: 'signal' }] }
}

/** A generic single-in/single-out node for any kind without a spec. */
const FALLBACK: KindPorts = { inputs: [IN], outputs: [OUT] }

/** Fresh default ports for a node of the given kind (new arrays each call). */
export function defaultPortsForKind(kind: ScenarioNodeKind): { inputs: ScenarioPort[]; outputs: ScenarioPort[] } {
  const spec = PORTS[kind] ?? FALLBACK
  return { inputs: spec.inputs.map(p), outputs: spec.outputs.map(p) }
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
  const seenIn = new Set<string>()
  const seenOut = new Set<string>()
  for (const node of subScenario.nodes) {
    const name = typeof node.config['name'] === 'string' ? node.config['name'].trim() : ''
    if (!name) continue
    if (node.kind === 'input' && !seenIn.has(name)) {
      seenIn.add(name)
      inputs.push(p({ id: `param:${name}`, name, dataType: dataTypeForValueType(node.config['valueType']), flow: 'value', ...(node.config['required'] === true ? { required: true } : {}) }))
    } else if (node.kind === 'output' && !seenOut.has(name)) {
      seenOut.add(name)
      outputs.push(p({ id: `output:${name}`, name, role: 'response', flow: 'both' }))
    }
  }
  // A sub-scenario that returns no data still needs to signal completion so a
  // parent can sequence the next node: with no `output` node, expose a single
  // `done` trigger ("Ensuite") instead of an empty output column.
  if (outputs.length === 0) {
    outputs.push(p({ id: 'done', name: 'then', role: 'then', flow: 'signal' }))
  }
  return { inputs, outputs }
}

// --- Link validation by port flow class -----------------------------------

/** Can an output of `outputFlow` feed an input that accepts `inputAccepts`?
 * `both` outputs feed anything; otherwise the classes must match. */
export function canConnectFlow(outputFlow: PortFlow, inputAccepts: PortFlow): boolean {
  return outputFlow === 'both' || outputFlow === inputAccepts
}

/** Flow of a source output handle. The implicit `error` port is `both`;
 * a switch's dynamically-added case outputs (not in the model) are `signal`. */
export function outputPortFlow(outputs: ScenarioPort[], handleId: string, kind: ScenarioNodeKind): PortFlow {
  if (handleId === 'error') return 'both'
  const port = outputs.find((o) => o.id === handleId)
  if (port?.flow) return port.flow
  // Derive from the role for ports stamped before `flow` existed.
  if (port?.role === 'response') return 'both'
  if (port?.role === 'then' || port?.role === 'else' || port?.role === 'case' || port?.role === 'default') return 'signal'
  if (kind === 'switch') return 'signal'
  return 'value'
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

/** Validate a scenario edge by port flow class (value / signal / both). */
export function isValidScenarioConnection(args: {
  sourceKind: ScenarioNodeKind
  sourceOutputs: ScenarioPort[]
  sourceHandle: string
  targetKind: ScenarioNodeKind
  targetInputs: ScenarioPort[]
  targetHandle: string
}): boolean {
  return canConnectFlow(
    outputPortFlow(args.sourceOutputs, args.sourceHandle, args.sourceKind),
    inputPortFlow(args.targetInputs, args.targetHandle, args.targetKind)
  )
}
