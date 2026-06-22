import type { RuntimeId } from './baseTypes'
import type { FolderItem } from './folderTypes'
import type { ScenarioNodeKind } from '../scenarioKindRegistry'

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
  // A collection (array). Distinct from `object` so a list-only input (the
  // AddToList/RemoveFromList target) accepts lists/arrays but refuses a plain
  // object. `json` stays the ambiguous "either" — compatible with both.
  | 'list'
  // A structured object (the `object` node's output). Distinct from `list` so
  // it can't land on a list-only target.
  | 'object'

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

/**
 * Connection compatibility class for a port.
 * - On an **output**: `value` (A) pushes a value; `signal` (B) only signals
 *   "action done" (no value); `both` (AB) does both (e.g. `response`, `error`).
 * - On an **input**: `value` accepts A/AB (data/body inputs); `signal` accepts
 *   B/AB (the header launch trigger).
 * A link is valid when `output === 'both'` or `output === inputAccepts`.
 */
export type PortFlow = 'value' | 'signal' | 'both'

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
  /** Connection class (value / signal / both) — see {@link PortFlow}. */
  flow?: PortFlow
}

/**
 * Open catalogue of node kinds (epic §5). The union is INVERTED from the
 * single-source-of-truth registry's keys: adding a node kind is a single edit to
 * `SCENARIO_KIND_REGISTRY` (its ports / capabilities / docs / catalogue meta),
 * and every dependent list — this union, the MCP `z.enum`, the add-node
 * catalogue, the capability sets, the port map, the docs record — is derived
 * from it (a `default → assertNever` exhaustiveness guard on the executor switch
 * + a drift-guard test catch any layer that forgets a kind). Re-exported from
 * the registry so the catalogue/runner contracts grow per-kind there, never by
 * touching the base node shape.
 */
export type { ScenarioNodeKind } from '../scenarioKindRegistry'

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
  /**
   * Child items — a scenario doubles as a folder-like container: requests
   * authored inside the scenario (and sub-folders) live here, show as its
   * children in the sidebar, and otherwise behave like any tree item (open as
   * tabs, indexed, response history). Optional for back-compat with scenarios
   * persisted before this existed; treat a missing value as `[]`.
   */
  items?: FolderItem[]
}
