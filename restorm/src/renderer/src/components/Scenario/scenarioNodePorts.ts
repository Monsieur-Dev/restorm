import type { ScenarioNodeKind, ScenarioPort, ScenarioDataType, ScenarioPortRole } from '../../../../shared/types/collections'

/**
 * Default input/output ports per node kind (epic §5b "per-kind
 * derivatives"). Port arity + roles are what visually distinguishes an
 * `If` (then/else) from a `Request` (response) from a `ForEach`
 * (each/done) — the shared NodeBox renders whatever ports a node carries,
 * so the kind specialisation lives in data here rather than in 21
 * component subclasses. The error port is implicit (the NodeBox always
 * draws it) and is never listed here.
 *
 * These are *defaults* stamped when a node is created; arity can later be
 * user-edited (switch cases) or derived from a reference (request slots,
 * sub-scenario params) without changing this table.
 */

interface PortSpec {
  id: string
  name?: string
  dataType?: ScenarioDataType
  role?: ScenarioPortRole
}

function p(spec: PortSpec): ScenarioPort {
  return {
    id: spec.id,
    name: spec.name ?? '',
    dataType: spec.dataType ?? 'any',
    ...(spec.role ? { role: spec.role } : {})
  }
}

interface KindPorts {
  inputs: PortSpec[]
  outputs: PortSpec[]
}

const IN = { id: 'in' }
const OUT = { id: 'out' }

const PORTS: Partial<Record<ScenarioNodeKind, KindPorts>> = {
  // Sources & control
  start: { inputs: [], outputs: [OUT] },
  input: { inputs: [], outputs: [{ id: 'value', name: 'value' }] },
  if: { inputs: [IN], outputs: [{ id: 'then', name: 'then', role: 'then' }, { id: 'else', name: 'else', role: 'else' }] },
  switch: { inputs: [IN], outputs: [{ id: 'case1', name: 'case 1', role: 'case' }, { id: 'default', name: 'default', role: 'default' }] },
  // Requests & composition
  request: { inputs: [IN], outputs: [{ id: 'response', name: 'response', dataType: 'response', role: 'response' }] },
  runScenario: { inputs: [IN], outputs: [{ id: 'result', name: 'result', role: 'response' }] },
  // Iteration & collections
  forEach: { inputs: [{ id: 'items', name: 'items', dataType: 'json' }], outputs: [{ id: 'each', name: 'each', role: 'then' }, { id: 'done', name: 'done', role: 'else' }] },
  aggregate: { inputs: [{ id: 'items', name: 'items', dataType: 'json' }], outputs: [{ id: 'result', name: 'result' }] },
  map: { inputs: [{ id: 'items', name: 'items', dataType: 'json' }], outputs: [{ id: 'mapped', name: 'mapped', dataType: 'json' }] },
  filter: { inputs: [{ id: 'items', name: 'items', dataType: 'json' }], outputs: [{ id: 'kept', name: 'kept', dataType: 'json' }] },
  // Time
  wait: { inputs: [IN], outputs: [OUT] },
  waitUntil: { inputs: [{ id: 'in', name: '', dataType: 'duration' }], outputs: [OUT] },
  now: { inputs: [], outputs: [{ id: 'value', name: 'now', dataType: 'string' }] },
  // Data & compute
  arithmetic: { inputs: [{ id: 'a', name: 'a', dataType: 'number' }, { id: 'b', name: 'b', dataType: 'number' }], outputs: [{ id: 'result', name: 'result', dataType: 'number' }] },
  comparator: { inputs: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }], outputs: [{ id: 'result', name: 'result', dataType: 'boolean' }] },
  boolean: { inputs: [{ id: 'a', name: 'a', dataType: 'boolean' }, { id: 'b', name: 'b', dataType: 'boolean' }], outputs: [{ id: 'result', name: 'result', dataType: 'boolean' }] },
  template: { inputs: [{ id: 'vars', name: 'vars', dataType: 'json' }], outputs: [{ id: 'text', name: 'text', dataType: 'string' }] },
  setVariable: { inputs: [{ id: 'value', name: 'value' }], outputs: [{ id: 'value', name: 'value' }] },
  getVariable: { inputs: [], outputs: [{ id: 'value', name: 'value' }] },
  transform: { inputs: [{ id: 'value', name: 'value' }], outputs: [{ id: 'value', name: 'value' }] },
  // Utilities
  log: { inputs: [{ id: 'value', name: 'value' }], outputs: [OUT] },
  assert: { inputs: [{ id: 'value', name: 'value' }], outputs: [{ id: 'then', name: 'pass', role: 'then' }, { id: 'else', name: 'fail', role: 'else' }] }
}

/** A generic single-in/single-out node for any kind without a spec. */
const FALLBACK: KindPorts = { inputs: [IN], outputs: [OUT] }

/** Fresh default ports for a node of the given kind (new arrays each call). */
export function defaultPortsForKind(kind: ScenarioNodeKind): { inputs: ScenarioPort[]; outputs: ScenarioPort[] } {
  const spec = PORTS[kind] ?? FALLBACK
  return { inputs: spec.inputs.map(p), outputs: spec.outputs.map(p) }
}
