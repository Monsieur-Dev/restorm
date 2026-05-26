import type { ScenarioNodeKind, ScenarioPort, ScenarioDataType, ScenarioPortRole, PortFlow } from './types/collections'

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
  if: { inputs: [IN, { id: 'left', name: 'left' }, { id: 'right', name: 'right' }], outputs: [{ id: 'then', name: 'then', role: 'then', flow: 'signal' }, { id: 'else', name: 'else', role: 'else', flow: 'signal' }] },
  switch: { inputs: [IN, { id: 'on', name: 'on' }], outputs: [{ id: 'default', name: 'default', role: 'default', flow: 'signal' }] },
  // Requests & composition
  httpRequest: { inputs: [IN, { id: 'env', name: 'env', flow: 'value' }], outputs: [{ id: 'response', name: 'response', dataType: 'response', role: 'response', flow: 'both' }] },
  runScenario: { inputs: [IN], outputs: [{ id: 'result', name: 'result', role: 'response', flow: 'both' }] },
  // Iteration & collections
  forEach: { inputs: [{ id: 'items', name: 'items', dataType: 'json', required: true }], outputs: [{ id: 'each', name: 'each', role: 'then', flow: 'both' }, { id: 'done', name: 'done', role: 'else', flow: 'signal' }] },
  aggregate: { inputs: [{ id: 'items', name: 'items', dataType: 'json', required: true }], outputs: [{ id: 'result', name: 'result', flow: 'value' }] },
  map: { inputs: [{ id: 'items', name: 'items', dataType: 'json', required: true }], outputs: [{ id: 'mapped', name: 'mapped', dataType: 'json', flow: 'value' }] },
  filter: { inputs: [{ id: 'items', name: 'items', dataType: 'json', required: true }], outputs: [{ id: 'kept', name: 'kept', dataType: 'json', flow: 'value' }] },
  // Time
  wait: { inputs: [IN, { id: 'duration', name: 'duration', dataType: 'duration' }], outputs: [{ id: 'out', name: 'then', role: 'then', flow: 'signal' }] },
  waitUntil: { inputs: [{ id: 'until', name: 'until', required: true }], outputs: [{ id: 'out', name: 'then', role: 'then', flow: 'signal' }] },
  now: { inputs: [IN], outputs: [{ id: 'value', name: 'now', dataType: 'string', flow: 'value' }] },
  // Data & compute
  arithmetic: { inputs: [{ id: 'a', name: 'a', dataType: 'number', required: true }, { id: 'b', name: 'b', dataType: 'number' }], outputs: [{ id: 'result', name: 'result', dataType: 'number', flow: 'value' }] },
  comparator: { inputs: [{ id: 'a', name: 'a', required: true }, { id: 'b', name: 'b', required: true }], outputs: [{ id: 'result', name: 'result', dataType: 'boolean', flow: 'value' }] },
  boolean: { inputs: [{ id: 'a', name: 'a', dataType: 'boolean', required: true }, { id: 'b', name: 'b', dataType: 'boolean', required: true }], outputs: [{ id: 'result', name: 'result', dataType: 'boolean', flow: 'value' }] },
  template: { inputs: [{ id: 'vars', name: 'vars', dataType: 'json' }], outputs: [{ id: 'text', name: 'text', dataType: 'string', flow: 'value' }] },
  setVariable: { inputs: [{ id: 'value', name: 'value' }], outputs: [{ id: 'event', name: 'event', flow: 'signal' }] },
  getVariable: { inputs: [], outputs: [{ id: 'value', name: 'value', flow: 'value' }] },
  transform: { inputs: [{ id: 'value', name: 'value', required: true }], outputs: [{ id: 'out', name: 'value', flow: 'value' }] },
  // Utilities
  log: { inputs: [{ id: 'value', name: 'value', required: true }], outputs: [OUT] },
  assert: { inputs: [{ id: 'value', name: 'value', required: true }], outputs: [{ id: 'then', name: 'pass', role: 'then', flow: 'signal' }, { id: 'else', name: 'fail', role: 'else', flow: 'signal' }] }
}

/** A generic single-in/single-out node for any kind without a spec. */
const FALLBACK: KindPorts = { inputs: [IN], outputs: [OUT] }

/** Fresh default ports for a node of the given kind (new arrays each call). */
export function defaultPortsForKind(kind: ScenarioNodeKind): { inputs: ScenarioPort[]; outputs: ScenarioPort[] } {
  const spec = PORTS[kind] ?? FALLBACK
  return { inputs: spec.inputs.map(p), outputs: spec.outputs.map(p) }
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
