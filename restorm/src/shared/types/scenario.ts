import type { RuntimeId } from './baseTypes'
import type { FolderItem } from './folderTypes'

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
 * Open catalogue of node kinds (epic §5). New boxes are added here +
 * a derived component/runner, without touching the base node shape.
 */
export type ScenarioNodeKind =
  // Sources & control
  | 'input'
  | 'output'
  | 'if'
  | 'switch'
  // Requests & composition
  | 'httpRequest'
  | 'runScenario'
  // Socket.IO — a long-lived connection (`socketioConnect`) that re-emits each
  // received event on its matching output port (switch-like), plus the two
  // actions that drive an already-declared connection: `socketioSend` emits a
  // message on it, `socketioClose` stops it. Send / close reference the connect
  // node by id.
  | 'socketioConnect'
  | 'socketioSend'
  | 'socketioClose'
  // Raw WebSocket — the same connect/send/close trio as Socket.IO, but a raw WS
  // has no named events: `websocketConnect` re-emits EVERY received frame on a
  // single `message` output (no per-event ports), `websocketSend` sends a raw
  // payload (no channel), `websocketClose` stops it.
  | 'websocketConnect'
  | 'websocketSend'
  | 'websocketClose'
  // Iteration & collections
  | 'forEach'
  | 'aggregate'
  | 'map'
  | 'filter'
  // List mutation — append / remove values to / from a list.
  | 'addToList'
  | 'removeFromList'
  // Loops — `for` is a numeric-range forEach; `while` / `doWhile` reuse the
  // `if` condition mechanism (operands + operator → body/done), the loop
  // closed by a user-wired edge back into the node.
  | 'for'
  | 'while'
  | 'doWhile'
  // Time
  | 'wait'
  | 'waitUntil'
  | 'now'
  // Timer — fires its `tick` body on each interval (frequency or cron), bounded
  // by an optional duration / end date.
  | 'timer'
  // Data & compute
  | 'arithmetic'
  | 'comparator'
  | 'boolean'
  | 'object'
  | 'setVariable'
  | 'getVariable'
  | 'transform'
  // Run user TypeScript/JavaScript in a sandbox (QuickJS) — transform/validate
  // data with a curated stdlib; the returned value is the node's `result`.
  | 'code'
  // Type conversion — explicit cast since comparisons / aggregates are strict.
  | 'cast'
  // Regular expressions — extract / match / replace / split on a string.
  | 'regex'
  // JSON — parse a string into a value, or stringify a value.
  | 'json'
  // XML / YAML — parse a string into a value, or stringify a value.
  | 'xml'
  | 'yaml'
  // Crypto — base64 / hashes / HMAC / UUID over a string.
  | 'crypto'
  // JWT — decode a compact token into header + payload + signature.
  | 'jwt'
  // Date math — shift / format / diff an existing date (the clock is `now`).
  | 'datetime'
  // Retry — re-runs its body (an error-boundary scope) with a backoff policy.
  | 'retry'
  // Object reshaping — get / set / merge / pick / omit / keys / values.
  | 'objectOp'
  // URL — encode / decode a component, parse / build a query, parse a URL.
  | 'url'
  // Random / faker — int / float / string / boolean / pick (optional seed).
  | 'random'
  // List reshaping — sort / unique / reverse / flatten / chunk / slice / groupBy.
  | 'listOp'
  // CSV — parse a CSV string into rows / stringify a list back to CSV.
  | 'csv'
  // Scalar math — round / floor / ceil / trunc / abs / sign / sqrt / min / max / clamp.
  | 'math'
  // JSON Schema validation (ajv) — routes valid / invalid + the error list.
  | 'schema'
  // Read a file (path relative to the scenario, or absolute) → its text.
  | 'readFile'
  // Write / append text to a file (path relative to the scenario, or absolute).
  | 'writeFile'
  // Utilities
  | 'log'
  // Deliberate failure — throws a message (for error branches / retry tests).
  | 'throw'
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
  /**
   * Child items — a scenario doubles as a folder-like container: requests
   * authored inside the scenario (and sub-folders) live here, show as its
   * children in the sidebar, and otherwise behave like any tree item (open as
   * tabs, indexed, response history). Optional for back-compat with scenarios
   * persisted before this existed; treat a missing value as `[]`.
   */
  items?: FolderItem[]
}
