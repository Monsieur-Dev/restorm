import type { RuntimeId } from './baseTypes'

/**
 * Scenarios — dataflow graphs of orchestrated requests (restorm's answer
 * to multi-step / long-running orchestration). A scenario is a tree item
 * placeable anywhere (never bound to an env-folder); data flows along
 * edges between typed ports of nodes.
 *
 * This module is the data-model contract only. The execution engine,
 * editor and persistence build on these shapes.
 */

/**
 * Port value type. Compatibility is deliberately laxist at design time
 * (`any` ↔ everything, light coercions, a selector-bearing edge is an
 * unknown type and therefore compatible with anything); real
 * incompatibilities surface at runtime on the node's error port.
 */
export type ScenarioDataType =
  | 'any'
  | 'json'
  | 'number'
  | 'string'
  | 'boolean'
  | 'duration'
  | 'response'
  | 'status'

/**
 * Semantic role of a port. Drives the default edge colour (then=green,
 * else=blue, response=green, error=red, …) and the engine's routing.
 * Open-ended so new node kinds can introduce their own roles.
 */
export type ScenarioPortRole =
  | 'then'
  | 'else'
  | 'case'
  | 'default'
  | 'response'
  | 'status'
  | 'error'
  | (string & {})

export interface ScenarioPort {
  id: RuntimeId
  name: string
  dataType: ScenarioDataType
  /** Semantic role; drives default edge colour + routing. */
  role?: ScenarioPortRole
  /** Explicit default colour for edges leaving this port (overrides the role default). */
  defaultEdgeColor?: string
  /** Mandatory input: flagged red in the editor until a link points to it. */
  required?: boolean
}

/**
 * Open catalogue of node kinds (epic §5). New boxes are added here +
 * a derived component/runner, without touching the base node shape.
 */
export type ScenarioNodeKind =
  // Sources & control
  | 'input'
  | 'if'
  | 'switch'
  // Requests & composition
  | 'request'
  | 'runScenario'
  // Iteration & collections
  | 'forEach'
  | 'aggregate'
  | 'map'
  | 'filter'
  // Time
  | 'wait'
  | 'waitUntil'
  | 'now'
  // Data & compute
  | 'arithmetic'
  | 'comparator'
  | 'boolean'
  | 'template'
  | 'setVariable'
  | 'getVariable'
  | 'transform'
  // Utilities
  | 'log'
  | 'assert'

/**
 * A node on the scenario surface. The common contract (header, ports,
 * error port, presentation) lives here; per-`kind` behaviour is carried
 * in `config` and specialised by the matching NodeBox / runner. Port
 * arity is not fixed by kind: it can be fixed, user-configured (switch
 * cases), or derived from a reference (request slots, sub-scenario
 * params).
 */
export interface ScenarioNode {
  id: RuntimeId
  kind: ScenarioNodeKind
  /** Per-kind configuration (literal input values, operator, ref ids, …). */
  config: Record<string, unknown>
  inputs: ScenarioPort[]
  outputs: ScenarioPort[]
  position: { x: number; y: number }
  /** Free annotation shown on the box. */
  note?: string
  /** Box colour; text colour is auto-derived via `getContrastColor`. */
  color?: string
  /** Collapsed boxes show only their header, ports become edge handles. */
  collapsed?: boolean
}

/**
 * A directed link port→port. Data follows the edge. An optional JSON
 * `selector` reshapes the value in transit (e.g. `$.cooldown.expiration`).
 */
export interface ScenarioEdge {
  /** Stable id (edge selection, MCP disconnect, React Flow key). */
  id: RuntimeId
  from: { nodeId: RuntimeId; portId: RuntimeId }
  to: { nodeId: RuntimeId; portId: RuntimeId }
  /** JSON selector applied to the value as it flows along the edge. */
  selector?: string
  /** Explicit colour; falls back to the source port's role default. */
  color?: string
}

/** A named input parameter of the scenario, injected by an Input node. */
export interface ScenarioParam {
  id: RuntimeId
  name: string
  dataType: ScenarioDataType
  required: boolean
}

/**
 * A scenario tree item. `type: 'scenario'` discriminates it from
 * requests inside `FolderItem`.
 */
export interface Scenario {
  type: 'scenario'
  id: RuntimeId
  name: string
  notes?: string
  tags: string[]
  params: ScenarioParam[]
  nodes: ScenarioNode[]
  edges: ScenarioEdge[]
}
