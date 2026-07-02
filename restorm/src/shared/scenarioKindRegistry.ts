import type { ScenarioDataType, ScenarioPortRole, PortFlow } from './types/scenario'
import { LIST_MUTATION_DEFAULT_VALUE_ID } from './scenarioListMutationValues'

/**
 * The SINGLE source of truth for scenario node kinds — one metadata record per
 * kind, keyed by the kind name. The `ScenarioNodeKind` union itself is derived
 * from this object's keys (see {@link ScenarioNodeKind} in `types/scenario.ts`),
 * and every per-kind list the rest of the app needs (the MCP `z.enum`, the
 * add-node catalogue, the port map, the capability sets, the docs record, the
 * static-preview wrapper set and the request-binding set) is DERIVED from here
 * rather than re-listed by hand — so adding / removing / renaming a kind is a
 * single edit, and any layer that forgets it fails the drift-guard test instead
 * of silently diverging.
 *
 * This registry is executor-free on purpose: executors live in `src/main`
 * (they import sockets / fs / gRPC / QuickJS) and a single object referencing
 * them would drag main code into the renderer bundle. The runtime executor map
 * stays a main-only switch (`main/scenarioEngine/executors/registry.ts`); a
 * guard test cross-checks it against these keys + a compile-time exhaustiveness
 * assert, so a kind added here without an executor fails the build.
 *
 * Authored with `satisfies Record<ScenarioNodeKind, KindSpec>` rather than a
 * type annotation, so the object's KEYS stay the literal-union source the
 * `ScenarioNodeKind` type is inverted from.
 */

// --- Structural metadata types (the registry's value shape) ----------------

/** Catalogue grouping — drives the separators / submenus in the add-node menu. */
export type ScenarioNodeCategory =
  | 'control' | 'composition' | 'lists' | 'loops' | 'time' | 'math' | 'compute' | 'algorithmie' | 'dataFormats' | 'encoding' | 'utility' | 'ux'

/** One port declaration in a kind's static port map (the `in` header trigger is
 * NOT listed here — it is prepended centrally for every kind that accepts an
 * input event; see `defaultPortsForKind`). */
export interface PortSpec {
  id: string
  name?: string
  dataType?: ScenarioDataType
  role?: ScenarioPortRole
  required?: boolean
  flow?: PortFlow
}

/** A kind's static input/output ports (its own data ports — the header trigger,
 * implicit `error` and implicit `done` ports are not listed). */
export interface KindPorts {
  inputs: PortSpec[]
  outputs: PortSpec[]
}

/** Human/agent-facing documentation for a kind — the data behind the
 * `describe_scenario_kinds` MCP tool. */
export interface ScenarioKindDoc {
  /** One-line purpose. */
  summary: string
  /** Per-`config`-key meaning. */
  config?: Record<string, string>
}

/**
 * Everything the shared / renderer layers need to know about a kind. Executor
 * is deliberately absent (main-only — see the module doc). Each flag carries a
 * documented default so the registry only states a kind's exceptions.
 */
export interface KindSpec {
  // --- Catalogue meta (add-node palette + node box header) ---
  /** i18n key under `scenario.nodes.*`, falling back to `defaultLabel`. */
  labelKey: string
  defaultLabel: string
  /** Codicon glyph shown on the node header + palette entry. */
  icon: string
  /** Group the kind belongs to (separators / submenus in the add-node menu). */
  category: ScenarioNodeCategory

  // --- Capability flags (each defaults so only exceptions are stated) ---
  /** Carries the header input-event launch trigger (`in` port). Default true —
   * only the `output` sink would opt out (none do today). */
  acceptsInputEvent?: boolean
  /** Draws the implicit `error` output port. Default true; opt-outs are sinks /
   * pure reads / the retry error-boundary (`output`, `now`, `retry`). */
  hasErrorPort?: boolean
  /** Draws the implicit `done` completion port. Default true; `output` (a sink)
   * and `throw` (never completes normally) opt out. */
  hasDonePort?: boolean
  /** Inspector preview is fully derived from config (no run needed). Default false. */
  staticPreview?: boolean
  /** Output token genuinely IS the wrapper object its preview models, so a
   * downstream selector must NOT unwrap it (`transform`/`input`/`object`).
   * Default false. */
  previewWrapper?: boolean
  /** Binds a sidebar request through `config.requestId` (reverse-nav + delete
   * flow). Default false. */
  requestBinding?: boolean

  /** Static input/output ports (the `in`/`error`/`done` ports are implicit). */
  ports: KindPorts
  /** Documentation surfaced by `describe_scenario_kinds`. */
  doc: ScenarioKindDoc
}

// Generic single-out value port (matches the legacy FALLBACK output). Authored
// inline per kind below for clarity rather than referenced, since every kind has
// an explicit port map.

/**
 * The registry. KEY ORDER IS LOAD-BEARING: the add-node catalogue is derived in
 * this exact order (it drives the palette grouping), so entries are laid out in
 * the catalogue's display order, grouped by category.
 */
export const SCENARIO_KIND_REGISTRY = {
  // --- Sources & control ---
  input: {
    labelKey: 'scenario.nodes.input', defaultLabel: 'Input / Param', icon: 'symbol-parameter', category: 'control',
    staticPreview: true, previewWrapper: true,
    ports: { inputs: [], outputs: [{ id: 'value', name: 'value', flow: 'both' }] },
    doc: {
      summary: 'Declares a named scenario input/param. Seeded at run start from run_scenario params; prompts the user mid-run if reached without a value.',
      config: { name: 'Param name (the key callers pass).', valueType: 'Typed default value `{ type, value }` used when no param is supplied.' }
    }
  },
  output: {
    labelKey: 'scenario.nodes.output', defaultLabel: 'Output / Return', icon: 'export', category: 'control',
    hasErrorPort: false, hasDonePort: false, staticPreview: true,
    ports: { inputs: [{ id: 'value', name: 'value' }], outputs: [] },
    doc: {
      summary: 'Declares a named scenario output. Consumes a value and exposes it as one of the scenario\'s results (a parent runScenario reads it as `output:<name>`).',
      config: { name: 'Output name.' }
    }
  },
  if: {
    labelKey: 'scenario.nodes.if', defaultLabel: 'If', icon: 'git-compare', category: 'control',
    staticPreview: true,
    ports: { inputs: [{ id: 'left', name: 'left' }, { id: 'right', name: 'right' }], outputs: [{ id: 'then', name: 'then', role: 'then', flow: 'both' }, { id: 'else', name: 'else', role: 'else', flow: 'both' }] },
    doc: {
      summary: 'Branch: compares two operands with `operator`, routing the trigger value to `then` (true) or `else` (false). With no operands wired, falls back to the truthiness of the `in` signal.',
      config: { operator: 'lt | lte | eq | gte | gt | ne | contains', left: 'Left operand (typed value; or wire the `left` port).', right: 'Right operand (typed value; or wire the `right` port).' }
    }
  },
  switch: {
    labelKey: 'scenario.nodes.switch', defaultLabel: 'Switch', icon: 'list-tree', category: 'control',
    staticPreview: true,
    ports: { inputs: [{ id: 'on', name: 'on' }], outputs: [{ id: 'default', name: 'default', role: 'default', flow: 'both' }] },
    doc: {
      summary: 'N-way branch: matches the `on` input against the case values; emits on `case-<id>` for a match, else on `default`.',
      config: { cases: 'Array of `{ id, value }`; each gets a `case-<id>` output port.' }
    }
  },
  retry: {
    labelKey: 'scenario.nodes.retry', defaultLabel: 'Retry', icon: 'refresh', category: 'control',
    hasErrorPort: false,
    ports: { inputs: [{ id: 'maxAttempts', name: 'maxAttempts', dataType: 'number' }, { id: 'delay', name: 'delay', dataType: 'number' }], outputs: [{ id: 'attempt', name: 'attempt', role: 'then', flow: 'both' }, { id: 'exhausted', name: 'exhausted', role: 'else', flow: 'both' }] },
    doc: {
      summary: 'Re-runs the body wired off `attempt` as an ERROR-BOUNDARY scope: an unhandled error in the body (or, for an httpRequest child, a response matching `retryOnStatus` / a non-2xx when `retryOnFailure`) marks the attempt failed and re-runs it per the backoff policy, up to `maxAttempts`. Success exits via the implicit `done` port; giving up exits via `exhausted`. Wire `attempt` → the action(s) to retry.',
      config: { maxAttempts: 'Max attempts (default 3).', backoff: 'fixed | linear | exponential.', delay: 'Base delay.', delayUnit: 'ms | s | min.', factor: 'Exponential factor (default 2).', maxDelay: 'Optional delay cap.', maxDelayUnit: 'ms | s | min.', retryOnError: 'Retry on a bubbled error (default true).', retryOnFailure: 'Retry on a non-2xx httpRequest response (default false).', retryOnStatus: 'HTTP status codes to retry on (e.g. [429, 503]).' }
    }
  },

  // --- Requests & composition ---
  httpRequest: {
    labelKey: 'scenario.nodes.httpRequest', defaultLabel: 'HTTP Request', icon: 'globe', category: 'composition',
    requestBinding: true,
    ports: { inputs: [{ id: 'env', name: 'env', flow: 'value' }, { id: 'requestOverride', name: 'override', dataType: 'object', flow: 'value' }], outputs: [{ id: 'response', name: 'response', dataType: 'response', role: 'response', flow: 'both' }] },
    doc: {
      summary: 'Runs a bound API request (REST/GraphQL/gRPC/WebSocket) and emits its `response`. Sequence it via the `in` trigger.',
      config: { requestId: 'Id of the request item to execute.', label: 'Display label on the box.' }
    }
  },
  soapRequest: {
    labelKey: 'scenario.nodes.soapRequest', defaultLabel: 'SOAP Request', icon: 'globe', category: 'composition',
    requestBinding: true,
    ports: { inputs: [{ id: 'env', name: 'env', flow: 'value' }], outputs: [{ id: 'response', name: 'response', dataType: 'response', role: 'response', flow: 'both' }] },
    doc: {
      summary: 'Runs a bound SOAP request (single request -> single response) and emits its parsed `response`. A `<soap:Fault>` surfaces on the response object (and routes to `error` when the call itself fails). Sequence it via the `in` trigger.',
      config: { requestId: 'Id of the SOAP request item to execute.', label: 'Display label on the box.' }
    }
  },
  runScenario: {
    labelKey: 'scenario.nodes.runScenario', defaultLabel: 'Run scenario', icon: 'circuit-board', category: 'composition',
    ports: { inputs: [], outputs: [{ id: 'result', name: 'result', role: 'response', flow: 'both' }] },
    doc: {
      summary: 'Runs another scenario as a sub-scenario. Wired `param:<name>` inputs feed its inputs; emits `output:<name>` per output node, plus `done` when it has none.',
      config: { scenarioId: 'Id of the scenario to run.', label: 'Display label on the box.' }
    }
  },
  socketioConnect: {
    labelKey: 'scenario.nodes.socketioConnect', defaultLabel: 'Socket.IO connect', icon: 'plug', category: 'composition',
    requestBinding: true,
    ports: { inputs: [], outputs: [{ id: 'connected', name: 'connected', flow: 'signal' }, { id: 'others', name: 'others', role: 'default', flow: 'both' }] },
    doc: {
      summary: 'Opens a long-lived Socket.IO connection from a bound request and listens. `connected` fires once the socket is open; each listened event re-emits its payload on a derived `event:<name>` output (switch-like), any other server-pushed event on `others`. The connection stays open until a socketioClose targets it (or the run is stopped), then `done` fires.',
      config: { requestId: 'Id of the Socket.IO request to connect (its resolved URL/headers/namespace).', connectionName: 'Unique-per-scenario name a socketioSend/socketioClose references for display (defaults to the request name).', events: 'Array of event names to listen for — each gets an `event:<name>` output port. The bound request\'s own event is seeded by default; add more for the switch-like fan-out.', label: 'Display label on the box.' }
    }
  },
  socketioSend: {
    labelKey: 'scenario.nodes.socketioSend', defaultLabel: 'Socket.IO send', icon: 'arrow-up', category: 'composition',
    ports: { inputs: [{ id: 'channel', name: 'channel', dataType: 'string' }, { id: 'payload', name: 'payload' }], outputs: [] },
    doc: {
      summary: 'Emits a message on an already-open Socket.IO connection (declared by a socketioConnect node). Pure-event action: triggered on `in`, it sends `payload` on the `channel` event, then sequences the next node via its `done` port. Errors (to the `error` port) when no connection is selected or it is not open.',
      config: { connectionNodeId: 'Id of the socketioConnect node whose connection to send on.', channel: 'Event name to emit (typed value; or wire `channel`). Defaults from the connect node\'s request.', payload: 'Message payload (a JSON code editor; or wire `payload`). Defaults from the connect node\'s request.' }
    }
  },
  socketioClose: {
    labelKey: 'scenario.nodes.socketioClose', defaultLabel: 'Socket.IO close', icon: 'debug-disconnect', category: 'composition',
    ports: { inputs: [], outputs: [] },
    doc: {
      summary: 'Closes an already-open Socket.IO connection (declared by a socketioConnect node), firing that node\'s `done`. Pure-event action: triggered on `in`, sequences the next node via its own `done` port. Errors (to the `error` port) when no connection is selected.',
      config: { connectionNodeId: 'Id of the socketioConnect node whose connection to close.' }
    }
  },
  websocketConnect: {
    labelKey: 'scenario.nodes.websocketConnect', defaultLabel: 'WebSocket connect', icon: 'plug', category: 'composition',
    requestBinding: true,
    ports: { inputs: [], outputs: [{ id: 'connected', name: 'connected', flow: 'signal' }, { id: 'message', name: 'message', flow: 'both' }] },
    doc: {
      summary: 'Opens a long-lived raw WebSocket connection from a bound request and listens. `connected` fires once the socket is open; EVERY received frame re-emits on the single `message` output (a raw WS has no named events). The connection stays open until a websocketClose targets it (or the run is stopped), then `done` fires.',
      config: { requestId: 'Id of the WebSocket request to connect (its resolved URL/headers).', connectionName: 'Unique-per-scenario name a websocketSend/websocketClose references for display (defaults to the request name).', label: 'Display label on the box.' }
    }
  },
  websocketSend: {
    labelKey: 'scenario.nodes.websocketSend', defaultLabel: 'WebSocket send', icon: 'arrow-up', category: 'composition',
    ports: { inputs: [{ id: 'payload', name: 'payload' }], outputs: [] },
    doc: {
      summary: 'Sends a raw payload on an already-open WebSocket connection (declared by a websocketConnect node) — no channel/event. Pure-event action: triggered on `in`, sequences the next node via `done`. Errors (to `error`) when no connection is selected or it is not open.',
      config: { connectionNodeId: 'Id of the websocketConnect node whose connection to send on.', payload: 'Message payload (a code editor; or wire `payload`).' }
    }
  },
  websocketClose: {
    labelKey: 'scenario.nodes.websocketClose', defaultLabel: 'WebSocket close', icon: 'debug-disconnect', category: 'composition',
    ports: { inputs: [], outputs: [] },
    doc: {
      summary: 'Closes an already-open raw WebSocket connection (declared by a websocketConnect node), firing that node\'s `done`. Pure-event action: triggered on `in`, sequences via its own `done`. Errors (to `error`) when no connection is selected.',
      config: { connectionNodeId: 'Id of the websocketConnect node whose connection to close.' }
    }
  },
  mqttConnect: {
    labelKey: 'scenario.nodes.mqttConnect', defaultLabel: 'MQTT connect', icon: 'plug', category: 'composition',
    requestBinding: true,
    ports: { inputs: [], outputs: [{ id: 'connected', name: 'connected', flow: 'signal' }, { id: 'message', name: 'message', flow: 'both' }] },
    doc: {
      summary: 'Opens a long-lived MQTT connection from a bound request and SUBSCRIBES to its topic. `connected` fires once subscribed; EVERY received message re-emits on the single `message` output (MQTT has no named events). The connection stays open until an mqttClose targets it (or the run is stopped), then `done` fires.',
      config: { requestId: 'Id of the MQTT request to connect (resolved URL/topic/QoS/auth/LWT).', connectionName: 'Unique-per-scenario name an mqttSend/mqttClose references for display (defaults to the request name).', label: 'Display label on the box.' }
    }
  },
  mqttSend: {
    labelKey: 'scenario.nodes.mqttSend', defaultLabel: 'MQTT publish', icon: 'arrow-up', category: 'composition',
    ports: { inputs: [{ id: 'payload', name: 'payload' }], outputs: [] },
    doc: {
      summary: 'Publishes a payload on an already-open MQTT connection (declared by an mqttConnect node), to that connection\'s topic (QoS/retain from the request). Pure-event action: triggered on `in`, sequences the next node via `done`. Errors (to `error`) when no connection is selected or it is not open.',
      config: { connectionNodeId: 'Id of the mqttConnect node whose connection to publish on.', payload: 'Message payload (a code editor; or wire `payload`).' }
    }
  },
  mqttClose: {
    labelKey: 'scenario.nodes.mqttClose', defaultLabel: 'MQTT close', icon: 'debug-disconnect', category: 'composition',
    ports: { inputs: [], outputs: [] },
    doc: {
      summary: 'Closes an already-open MQTT connection (declared by an mqttConnect node), firing that node\'s `done`. Pure-event action: triggered on `in`, sequences via its own `done`. Errors (to `error`) when no connection is selected.',
      config: { connectionNodeId: 'Id of the mqttConnect node whose connection to close.' }
    }
  },
  grpcConnect: {
    labelKey: 'scenario.nodes.grpcConnect', defaultLabel: 'gRPC connect', icon: 'plug', category: 'composition',
    requestBinding: true,
    ports: { inputs: [], outputs: [{ id: 'connected', name: 'connected', flow: 'signal' }, { id: 'message', name: 'message', flow: 'both' }] },
    doc: {
      summary: 'Opens a long-lived streaming gRPC call from a bound request (server / client / bidi, inferred from the request call type) and listens. `connected` fires once the call is open; EVERY received frame re-emits on the single `message` output (a streaming RPC has no named events). For server-streaming the request message is sent automatically on open; for client/bidi use grpcSend. The call stays open until a grpcClose targets it (or the run is stopped), then `done` fires.',
      config: { requestId: 'Id of the gRPC request to connect (its resolved address/metadata + service/method/call type).', connectionName: 'Unique-per-scenario name a grpcSend/grpcClose references for display (defaults to the request name).', label: 'Display label on the box.' }
    }
  },
  grpcSend: {
    labelKey: 'scenario.nodes.grpcSend', defaultLabel: 'gRPC send', icon: 'arrow-up', category: 'composition',
    ports: { inputs: [{ id: 'payload', name: 'payload' }], outputs: [] },
    doc: {
      summary: 'Writes a request message on an already-open streaming gRPC call (declared by a grpcConnect node) — client or bidi only, no channel. Pure-event action: triggered on `in`, sequences the next node via `done`. Errors (to `error`) when no connection is selected or it is not open.',
      config: { connectionNodeId: 'Id of the grpcConnect node whose call to write on.', payload: 'Request message (a code editor; or wire `payload`).' }
    }
  },
  grpcClose: {
    labelKey: 'scenario.nodes.grpcClose', defaultLabel: 'gRPC close', icon: 'debug-disconnect', category: 'composition',
    ports: { inputs: [], outputs: [] },
    doc: {
      summary: 'Half-closes an already-open streaming gRPC call (declared by a grpcConnect node), letting the server\'s final frames/response arrive and firing that node\'s `done`. Pure-event action: triggered on `in`, sequences via its own `done`. Errors (to `error`) when no connection is selected.',
      config: { connectionNodeId: 'Id of the grpcConnect node whose call to close.' }
    }
  },
  httpListen: {
    labelKey: 'scenario.nodes.httpListen', defaultLabel: 'HTTP server', icon: 'server', category: 'composition',
    requestBinding: true,
    ports: { inputs: [], outputs: [{ id: 'connected', name: 'connected', flow: 'signal' }, { id: 'served', name: 'served', flow: 'both' }] },
    doc: {
      summary: 'HOSTS a local HTTP mock server from a bound `server: true` HTTP request and listens INDEFINITELY (restorm serves, it does not call out — so there is NO `response` output). `connected` (a pure signal) fires once the server is listening; EACH request the mock serves re-emits its `{ request, response }` data on the `served` output. The server stays up — keeping the run in-progress — until an httpClose targets it (or the run is stopped), then `done` fires.',
      config: { requestId: 'Id of the server: true HTTP request to host (its METHOD + PATH + port + configured mock status/headers/body).', connectionName: 'Unique-per-scenario name an httpClose references for display (defaults to the request name).', label: 'Display label on the box.' }
    }
  },
  httpClose: {
    labelKey: 'scenario.nodes.httpClose', defaultLabel: 'HTTP close', icon: 'debug-disconnect', category: 'composition',
    ports: { inputs: [], outputs: [] },
    doc: {
      summary: 'Stops an already-listening HTTP mock server (declared by an httpListen node), freeing its port and firing that node\'s `done`. Pure-event action: triggered on `in`, sequences via its own `done`. Errors (to `error`) when no server is selected.',
      config: { connectionNodeId: 'Id of the httpListen node whose server to stop.' }
    }
  },
  grpcListen: {
    labelKey: 'scenario.nodes.grpcListen', defaultLabel: 'gRPC server', icon: 'server', category: 'composition',
    requestBinding: true,
    ports: { inputs: [], outputs: [{ id: 'connected', name: 'connected', flow: 'signal' }, { id: 'served', name: 'served', flow: 'both' }] },
    doc: {
      summary: 'HOSTS a local gRPC mock server from a bound `server: true` gRPC request and listens INDEFINITELY (restorm serves, it does not call out — so there is NO `response` output). `connected` (a pure signal) fires once the server is listening; EACH call the mock serves re-emits its `{ request, response }` data on the `served` output. The server stays up — keeping the run in-progress — until a grpcServerClose targets it (or the run is stopped), then `done` fires.',
      config: { requestId: 'Id of the server: true gRPC request to host (its port + proto + per-method mock responses/status).', connectionName: 'Unique-per-scenario name a grpcServerClose references for display (defaults to the request name).', label: 'Display label on the box.' }
    }
  },
  grpcServerClose: {
    labelKey: 'scenario.nodes.grpcServerClose', defaultLabel: 'gRPC server close', icon: 'debug-disconnect', category: 'composition',
    ports: { inputs: [], outputs: [] },
    doc: {
      summary: 'Stops an already-listening gRPC mock server (declared by a grpcListen node), freeing its port and firing that node\'s `done`. Pure-event action: triggered on `in`, sequences via its own `done`. Errors (to `error`) when no server is selected.',
      config: { connectionNodeId: 'Id of the grpcListen node whose server to stop.' }
    }
  },
  soapListen: {
    labelKey: 'scenario.nodes.soapListen', defaultLabel: 'SOAP server', icon: 'server', category: 'composition',
    requestBinding: true,
    ports: { inputs: [], outputs: [{ id: 'connected', name: 'connected', flow: 'signal' }, { id: 'served', name: 'served', flow: 'both' }] },
    doc: {
      summary: 'HOSTS a local SOAP mock server from a bound `server: true` SOAP request and listens INDEFINITELY (restorm serves, it does not call out — so there is NO `response` output). Each inbound POST is dispatched to a configured operation by its SOAPAction header or body operation name and answered with the canned SOAP envelope (a fault operation returns `<soap:Fault>`). `connected` (a pure signal) fires once the server is listening; EACH request the mock serves re-emits its `{ request, response }` data on the `served` output. The server stays up — keeping the run in-progress — until a soapClose targets it (or the run is stopped), then `done` fires.',
      config: { requestId: 'Id of the server: true SOAP request to host (its port + route + configured mock operations).', connectionName: 'Unique-per-scenario name a soapClose references for display (defaults to the request name).', label: 'Display label on the box.' }
    }
  },
  soapClose: {
    labelKey: 'scenario.nodes.soapClose', defaultLabel: 'SOAP close', icon: 'debug-disconnect', category: 'composition',
    ports: { inputs: [], outputs: [] },
    doc: {
      summary: 'Stops an already-listening SOAP mock server (declared by a soapListen node), freeing its port and firing that node\'s `done`. Pure-event action: triggered on `in`, sequences via its own `done`. Errors (to `error`) when no server is selected.',
      config: { connectionNodeId: 'Id of the soapListen node whose server to stop.' }
    }
  },
  graphqlListen: {
    labelKey: 'scenario.nodes.graphqlListen', defaultLabel: 'GraphQL server', icon: 'server', category: 'composition',
    requestBinding: true,
    ports: { inputs: [], outputs: [{ id: 'connected', name: 'connected', flow: 'signal' }, { id: 'served', name: 'served', flow: 'both' }] },
    doc: {
      summary: 'HOSTS a local GraphQL mock server from a bound `server: true` GraphQL request and listens INDEFINITELY (restorm serves operations from the configured SDL + resolvers, it does not call out — so there is NO `response` output). `connected` (a pure signal) fires once the server is listening; EACH operation the mock serves re-emits its `{ request, response }` data on the `served` output. The server stays up — keeping the run in-progress — until a graphqlClose targets it (or the run is stopped), then `done` fires.',
      config: { requestId: 'Id of the server: true GraphQL request to host (its port + endpoint path + SDL schema + canned/scripted resolvers).', connectionName: 'Unique-per-scenario name a graphqlClose references for display (defaults to the request name).', label: 'Display label on the box.' }
    }
  },
  graphqlClose: {
    labelKey: 'scenario.nodes.graphqlClose', defaultLabel: 'GraphQL close', icon: 'debug-disconnect', category: 'composition',
    ports: { inputs: [], outputs: [] },
    doc: {
      summary: 'Stops an already-listening GraphQL mock server (declared by a graphqlListen node), freeing its port and firing that node\'s `done`. Pure-event action: triggered on `in`, sequences via its own `done`. Errors (to `error`) when no server is selected.',
      config: { connectionNodeId: 'Id of the graphqlListen node whose server to stop.' }
    }
  },
  odataListen: {
    labelKey: 'scenario.nodes.odataListen', defaultLabel: 'OData server', icon: 'server', category: 'composition',
    requestBinding: true,
    ports: { inputs: [], outputs: [{ id: 'connected', name: 'connected', flow: 'signal' }, { id: 'served', name: 'served', flow: 'both' }] },
    doc: {
      summary: 'HOSTS a local OData v4 mock service from a bound `server: true` OData request and listens INDEFINITELY (restorm serves, it does not call out — so there is NO `response` output). It serves the request\'s CSDL ($metadata) + entity collections, applying the system query options ($filter/$select/$orderby/$top/$skip/$count/$expand) and `$batch`. `connected` (a pure signal) fires once the service is listening; EACH request the mock serves re-emits its `{ request, response }` data on the `served` output. The service stays up — keeping the run in-progress — until an odataClose targets it (or the run is stopped), then `done` fires.',
      config: { requestId: 'Id of the server: true OData request to host (its port + service root + CSDL + served entity data).', connectionName: 'Unique-per-scenario name an odataClose references for display (defaults to the request name).', label: 'Display label on the box.' }
    }
  },
  odataClose: {
    labelKey: 'scenario.nodes.odataClose', defaultLabel: 'OData close', icon: 'debug-disconnect', category: 'composition',
    ports: { inputs: [], outputs: [] },
    doc: {
      summary: 'Stops an already-listening OData mock service (declared by an odataListen node), freeing its port and firing that node\'s `done`. Pure-event action: triggered on `in`, sequences via its own `done`. Errors (to `error`) when no server is selected.',
      config: { connectionNodeId: 'Id of the odataListen node whose service to stop.' }
    }
  },
  graphqlSubscribe: {
    labelKey: 'scenario.nodes.graphqlSubscribe', defaultLabel: 'GraphQL subscribe', icon: 'broadcast', category: 'composition',
    requestBinding: true,
    ports: { inputs: [], outputs: [{ id: 'connected', name: 'connected', flow: 'signal' }, { id: 'message', name: 'message', flow: 'both' }] },
    doc: {
      summary: 'Opens a long-lived GraphQL SUBSCRIPTION from a bound request over Server-Sent Events and listens. `connected` fires once the subscription stream is open; EVERY pushed payload re-emits on the single `message` output (a subscription has no named events). A subscription is receive-only — there is no send. The stream stays open until a graphqlUnsubscribe targets it (or the run is stopped) or the server completes it, then `done` fires.',
      config: { requestId: 'Id of the GraphQL subscription request to consume (its endpoint URL + headers + subscription query/variables).', connectionName: 'Unique-per-scenario name a graphqlUnsubscribe references for display (defaults to the request name).', label: 'Display label on the box.' }
    }
  },
  graphqlUnsubscribe: {
    labelKey: 'scenario.nodes.graphqlUnsubscribe', defaultLabel: 'GraphQL unsubscribe', icon: 'debug-disconnect', category: 'composition',
    ports: { inputs: [], outputs: [] },
    doc: {
      summary: 'Stops an already-open GraphQL subscription (declared by a graphqlSubscribe node), tearing down the SSE stream and firing that node\'s `done`. Pure-event action: triggered on `in`, sequences via its own `done`. Errors (to `error`) when no subscription is selected.',
      config: { connectionNodeId: 'Id of the graphqlSubscribe node whose subscription to stop.' }
    }
  },

  // --- Lists (grouped into a "Lists" submenu) ---
  aggregate: {
    labelKey: 'scenario.nodes.aggregate', defaultLabel: 'Aggregate', icon: 'combine', category: 'lists',
    staticPreview: true,
    ports: { inputs: [{ id: 'items', name: 'items', dataType: 'json' }], outputs: [{ id: 'result', name: 'result', flow: 'both' }] },
    doc: {
      summary: 'Reduces a collection to a single `result` (count/sum/min/max/average/join).',
      config: { op: 'count | sum | min | max | average | join', field: 'Optional item field to read before reducing.', separator: 'Join separator (op=join).' }
    }
  },
  map: {
    labelKey: 'scenario.nodes.map', defaultLabel: 'Map', icon: 'arrow-swap', category: 'lists',
    staticPreview: true,
    ports: { inputs: [{ id: 'items', name: 'items', dataType: 'json' }], outputs: [{ id: 'mapped', name: 'mapped', dataType: 'json', flow: 'both' }] },
    doc: {
      summary: 'Transforms each item of a collection, emitting the new list on `mapped`.',
      config: { property: 'Item field to pick.', expression: 'Optional Handlebars template applied per item.' }
    }
  },
  filter: {
    labelKey: 'scenario.nodes.filter', defaultLabel: 'Filter', icon: 'filter', category: 'lists',
    staticPreview: true,
    ports: { inputs: [{ id: 'items', name: 'items', dataType: 'json' }], outputs: [{ id: 'kept', name: 'kept', dataType: 'json', flow: 'both' }, { id: 'rejected', name: 'rejected', dataType: 'json', flow: 'both' }] },
    doc: {
      summary: 'Partitions a collection by a predicate: matches on `kept`, non-matches on `rejected` (so dropped items can be routed, not lost).',
      config: { property: 'Item field to test.', operator: 'lt | lte | eq | gte | gt | ne | contains', value: 'Value to compare against.' }
    }
  },
  addToList: {
    labelKey: 'scenario.nodes.addToList', defaultLabel: 'Add to list', icon: 'diff-added', category: 'lists',
    staticPreview: true,
    ports: { inputs: [{ id: 'list', name: 'list', dataType: 'list' }, { id: LIST_MUTATION_DEFAULT_VALUE_ID, name: '', dataType: 'any' }], outputs: [{ id: 'result', name: 'result', dataType: 'json', flow: 'both' }] },
    doc: {
      summary: 'Appends each `values` row (one element apiece) to the `list` target, emitting the new list on `result`. Pure by default — persist it back with a downstream setVariable, or set `updateSourceVariable` to write it straight into the source variable.',
      config: { list: 'Target list: a list-typed variable reference `{ type:"variable", value:"<name>" }`, or wire a list into the `list` port. (No inline list literal — you can\'t author a list here.)', values: 'Rows of values to append: `{ id, value }[]` (like object properties); each row gets a `<id>` input port to wire.', updateSourceVariable: 'When true AND `list` is an un-wired variable, also writes the new list back into that variable (push). Default false (pure).' }
    }
  },
  removeFromList: {
    labelKey: 'scenario.nodes.removeFromList', defaultLabel: 'Remove from list', icon: 'diff-removed', category: 'lists',
    staticPreview: true,
    ports: { inputs: [{ id: 'list', name: 'list', dataType: 'list' }, { id: LIST_MUTATION_DEFAULT_VALUE_ID, name: '', dataType: 'any' }], outputs: [{ id: 'result', name: 'result', dataType: 'json', flow: 'both' }] },
    doc: {
      summary: 'Removes from `list` every element deep-equal to any `values` row, emitting the new list on `result`. Pure by default; `updateSourceVariable` writes it back to the source variable.',
      config: { list: 'Target list: a list-typed variable reference `{ type:"variable", value:"<name>" }`, or wire a list into the `list` port. (No inline list literal.)', values: 'Rows of values to remove: `{ id, value }[]` (like object properties); each row gets a `<id>` input port to wire.', updateSourceVariable: 'When true AND `list` is an un-wired variable, also writes the new list back into that variable. Default false (pure).' }
    }
  },
  listOp: {
    labelKey: 'scenario.nodes.listOp', defaultLabel: 'List ops', icon: 'list-flat', category: 'lists',
    staticPreview: true,
    ports: { inputs: [{ id: 'value', name: 'value', dataType: 'list' }, { id: 'key', name: 'key', dataType: 'string' }], outputs: [{ id: 'result', name: 'result', flow: 'both' }] },
    doc: {
      summary: 'Reshapes the `value` list on `result` (distinct from `aggregate`, which reduces, and `map`/`filter`, which work item-by-item): sort, unique, reverse, flatten, chunk, slice, or groupBy. A non-list operand → `error`.',
      config: { op: 'sort | unique | reverse | flatten | chunk | slice | groupBy', key: 'Item dot-path for sort/unique/groupBy.', order: 'asc | desc (sort).', depth: 'flatten depth (default 1).', size: 'chunk size.', start: 'slice start.', end: 'slice end.', value: 'Inline list when not wired.' }
    }
  },

  // --- Loops (grouped into a "Loops" submenu) ---
  forEach: {
    labelKey: 'scenario.nodes.forEach', defaultLabel: 'ForEach', icon: 'symbol-array', category: 'loops',
    ports: { inputs: [{ id: 'items', name: 'items', dataType: 'json' }], outputs: [{ id: 'each', name: 'each', role: 'then', flow: 'both' }] },
    doc: {
      summary: 'Iterates a collection: fans out `each` item, then fires `done` once every iteration\'s sub-graph has finished. `items` is wired or taken from a configured list.',
      config: { parallelism: '`{ enabled, count }` — bounded concurrent iterations (count≥2). Off = sequential.' }
    }
  },
  for: {
    labelKey: 'scenario.nodes.for', defaultLabel: 'For', icon: 'list-ordered', category: 'loops',
    ports: { inputs: [{ id: 'from', name: 'from', dataType: 'number' }, { id: 'to', name: 'to', dataType: 'number' }, { id: 'step', name: 'step', dataType: 'number' }], outputs: [{ id: 'each', name: 'index', role: 'then', flow: 'both' }] },
    doc: {
      summary: 'Numeric-range forEach: `for i = from; i <operator> to; i += step` — fans out each `i` on `each`, then `done`. Inputs override config.',
      config: { from: 'Range start (number).', to: 'Loop bound (number).', operator: 'Comparison vs `to`: < (default) | ≤ | = | ≥ | > | ≠.', step: 'Signed increment (0 → 1).', parallelism: '`{ enabled, count }` like forEach.' }
    }
  },
  while: {
    labelKey: 'scenario.nodes.while', defaultLabel: 'While', icon: 'sync', category: 'loops',
    staticPreview: true,
    ports: { inputs: [{ id: 'left', name: 'left' }, { id: 'right', name: 'right' }], outputs: [{ id: 'then', name: 'body', role: 'then', flow: 'signal' }] },
    doc: {
      summary: 'Loop (test-first): the `if` mechanism — routes to `then` (body) while the condition holds, else `done`. Close the loop by wiring the body back into `in` (or an operand); the engine re-fires on each pass.',
      config: { operator: 'lt | lte | eq | gte | gt | ne | contains', left: 'Left operand (or wire `left`).', right: 'Right operand (or wire `right`).' }
    }
  },
  doWhile: {
    labelKey: 'scenario.nodes.doWhile', defaultLabel: 'Do…While', icon: 'debug-restart', category: 'loops',
    staticPreview: true,
    ports: { inputs: [{ id: 'left', name: 'left' }, { id: 'right', name: 'right' }], outputs: [{ id: 'then', name: 'loop', role: 'then', flow: 'signal' }] },
    doc: {
      summary: 'Loop (body-first): same `if` mechanism as `while`, but placed AFTER the body so it runs at least once. `then` loops back to the body, `else` exits.',
      config: { operator: 'lt | lte | eq | gte | gt | ne | contains', left: 'Left operand (or wire `left`).', right: 'Right operand (or wire `right`).' }
    }
  },

  // --- Time (grouped into a "Timing" submenu) ---
  wait: {
    labelKey: 'scenario.nodes.wait', defaultLabel: 'Wait', icon: 'watch', category: 'time',
    staticPreview: true,
    ports: { inputs: [{ id: 'duration', name: 'duration', dataType: 'duration' }], outputs: [] },
    doc: {
      summary: 'Sleeps for a duration, then sequences the next node via its `done` port (no value passthrough). Aborts cleanly on Stop.',
      config: { duration: 'Duration value.', inputUnit: 'ms | s | min | h — unit for a wired `duration` (default s).', durationMs: 'Alternative fixed duration in ms.' }
    }
  },
  waitUntil: {
    labelKey: 'scenario.nodes.waitUntil', defaultLabel: 'Wait until', icon: 'clock', category: 'time',
    staticPreview: true,
    ports: { inputs: [{ id: 'until', name: 'until' }], outputs: [] },
    doc: {
      summary: 'Sleeps until a target time (ISO string or epoch ms); a past time fires immediately. Sequences via `done` (no value passthrough).',
      config: { until: 'Target time (or wire the `until` port).' }
    }
  },
  timer: {
    labelKey: 'scenario.nodes.timer', defaultLabel: 'Timer', icon: 'pulse', category: 'time',
    ports: { inputs: [{ id: 'frequency', name: 'frequency', dataType: 'number' }, { id: 'cron', name: 'cron', dataType: 'string' }, { id: 'duration', name: 'duration', dataType: 'number' }, { id: 'endDate', name: 'endDate' }], outputs: [{ id: 'tick', name: 'tick', role: 'then', flow: 'both' }] },
    doc: {
      summary: 'Fires its `tick` body on each interval — a frequency (number + unit) OR a `cron` expression — bounded by an optional total duration / end date, else it runs until the run is stopped. The `tick` value is the 0-based tick index; `done` fires (with the total tick count) when it stops. frequency / cron / duration / endDate are wireable inputs.',
      config: { mode: 'frequency | cron', frequency: 'Interval count when not wired (with `unit`).', unit: 's | min | h (default s).', cron: 'A 5/6-field cron expression (mode=cron).', duration: 'Optional total duration when not wired (with `durationUnit`).', durationUnit: 's | min | h.', endDate: 'Optional ISO end date (stop firing after it).' }
    }
  },
  now: {
    labelKey: 'scenario.nodes.now', defaultLabel: 'Now', icon: 'calendar', category: 'time',
    hasErrorPort: false, staticPreview: true,
    ports: { inputs: [], outputs: [{ id: 'value', name: 'now', dataType: 'string', flow: 'both' }] },
    doc: {
      summary: 'Emits the current time.',
      config: { format: 'datetime (ISO, default) | epoch | string.' }
    }
  },
  datetime: {
    labelKey: 'scenario.nodes.datetime', defaultLabel: 'Date math', icon: 'history', category: 'time',
    staticPreview: true,
    ports: { inputs: [{ id: 'value', name: 'value' }, { id: 'amount', name: 'amount' }, { id: 'other', name: 'other' }], outputs: [{ id: 'result', name: 'result', flow: 'both' }] },
    doc: {
      summary: 'Transforms an existing date wired/inline on `value` (the clock itself is the `now` node). add/subtract → shift by `amount` of `unit` → ISO string; format → a luxon pattern string; diff → `other − value` in `unit` → number. An unreadable date → `error`.',
      config: { op: 'add | subtract | format | diff', amount: 'Amount for add/subtract.', unit: 'milliseconds | seconds | minutes | hours | days | weeks | months | years.', format: 'luxon format pattern (format op; empty = ISO).', other: 'Second date for diff (typed value).', value: 'Inline date when not wired.' }
    }
  },

  // --- Math (grouped into a "Math" submenu) ---
  arithmetic: {
    labelKey: 'scenario.nodes.arithmetic', defaultLabel: 'Arithmetic', icon: 'symbol-operator', category: 'math',
    staticPreview: true,
    ports: { inputs: [{ id: 'a', name: 'a', dataType: 'number' }, { id: 'b', name: 'b', dataType: 'number' }], outputs: [{ id: 'result', name: 'result', dataType: 'number', flow: 'both' }] },
    doc: {
      summary: 'Computes `a op b` → number on `result`.',
      config: { op: 'add | sub | mul | div | mod | pow' }
    }
  },
  comparator: {
    labelKey: 'scenario.nodes.comparator', defaultLabel: 'Comparator', icon: 'equals', category: 'math',
    staticPreview: true,
    ports: { inputs: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }], outputs: [{ id: 'result', name: 'result', dataType: 'boolean', flow: 'both' }] },
    doc: {
      summary: 'Compares `a` and `b` with `operator` → boolean on `result`.',
      config: { operator: 'lt | lte | eq | gte | gt | ne | contains' }
    }
  },
  math: {
    labelKey: 'scenario.nodes.math', defaultLabel: 'Math', icon: 'symbol-numeric', category: 'math',
    staticPreview: true,
    ports: { inputs: [{ id: 'a', name: 'a', dataType: 'number' }, { id: 'precision', name: 'precision', dataType: 'number' }], outputs: [{ id: 'result', name: 'result', dataType: 'number', flow: 'both' }] },
    doc: {
      summary: 'Runs a scalar op on `a` → number on `result` (complements `arithmetic`): round/floor/ceil/trunc/abs/sign/sqrt, the two-operand min/max, or the bounded clamp. A non-finite operand / negative sqrt → `error`.',
      config: { op: 'round | floor | ceil | trunc | abs | sign | sqrt | min | max | clamp', b: 'Second operand (min/max).', min: 'Lower bound (clamp).', max: 'Upper bound (clamp).', precision: 'Decimal places (round).', a: 'Inline operand when not wired.' }
    }
  },

  // --- Algorithmie (grouped into an "Algorithmie" submenu) ---
  boolean: {
    labelKey: 'scenario.nodes.boolean', defaultLabel: 'Boolean', icon: 'symbol-boolean', category: 'algorithmie',
    staticPreview: true,
    ports: { inputs: [{ id: 'a', name: 'a', dataType: 'boolean' }, { id: 'b', name: 'b', dataType: 'boolean' }], outputs: [{ id: 'result', name: 'result', dataType: 'boolean', flow: 'both' }] },
    doc: {
      summary: 'Boolean logic `a op b` → boolean on `result`.',
      config: { op: 'and | or | xor | not' }
    }
  },
  object: {
    labelKey: 'scenario.nodes.object', defaultLabel: 'Object', icon: 'symbol-namespace', category: 'algorithmie',
    staticPreview: true, previewWrapper: true,
    ports: { inputs: [], outputs: [{ id: 'object', name: 'object', dataType: 'object', flow: 'both' }] },
    doc: {
      summary: 'Assembles an object from its named property inputs (port id = property name) on `object`.',
      config: {}
    }
  },
  objectOp: {
    labelKey: 'scenario.nodes.objectOp', defaultLabel: 'Object ops', icon: 'symbol-object', category: 'algorithmie',
    staticPreview: true,
    ports: { inputs: [{ id: 'value', name: 'value' }, { id: 'path', name: 'path', dataType: 'string' }], outputs: [{ id: 'result', name: 'result', flow: 'both' }] },
    doc: {
      summary: 'Reshapes the `value` object on `result` (distinct from the `object` BUILDER): get/set a dot-`path`, merge with `other`, pick/omit `keys`, or list keys/values. A non-object operand (where the op needs one) → `error`.',
      config: { op: 'get | set | merge | pick | omit | keys | values', path: 'Dot-path for get/set.', keys: 'Comma-separated keys for pick/omit.', other: 'Value to set / object to merge (typed value).', value: 'Inline object when not wired.' }
    }
  },
  setVariable: {
    labelKey: 'scenario.nodes.setVariable', defaultLabel: 'Set variable', icon: 'symbol-variable', category: 'algorithmie',
    staticPreview: true,
    ports: { inputs: [{ id: 'value', name: 'value' }], outputs: [] },
    doc: {
      summary: 'Stores the `value` input into the run\'s variable store under `name`; emits a signal on `event`.',
      config: { name: 'Variable name.' }
    }
  },
  getVariable: {
    labelKey: 'scenario.nodes.getVariable', defaultLabel: 'Get variable', icon: 'symbol-variable', category: 'algorithmie',
    staticPreview: true,
    ports: { inputs: [], outputs: [{ id: 'value', name: 'value', flow: 'both' }] },
    doc: {
      summary: 'Reads the run variable `name` onto `value`.',
      config: { name: 'Variable name.' }
    }
  },
  transform: {
    labelKey: 'scenario.nodes.transform', defaultLabel: 'Transform template', icon: 'symbol-string', category: 'algorithmie',
    staticPreview: true, previewWrapper: true,
    ports: { inputs: [{ id: 'value', name: 'value' }, { id: 'expression', name: 'expression' }], outputs: [{ id: 'out', name: 'value', flow: 'both' }] },
    doc: {
      summary: 'Applies a Handlebars `expression` to its `value` input + run variables, emitting the rendered result on `out`. Wire the optional `expression` input to drive the template text from an upstream value instead of the inline editor.',
      config: { expression: 'Handlebars template (used when the `expression` input is not wired).' }
    }
  },
  code: {
    labelKey: 'scenario.nodes.code', defaultLabel: 'Code (sandbox)', icon: 'code', category: 'algorithmie',
    ports: { inputs: [{ id: 'value', name: 'input' }, { id: 'code', name: 'code', dataType: 'string' }], outputs: [{ id: 'result', name: 'result', flow: 'both' }] },
    doc: {
      summary: 'Runs the user `code` in a per-language WASM runtime selected by `language` (TypeScript/JavaScript → QuickJS, Python → Pyodide, Lua → wasmoon, Ruby → ruby.wasm, R → WebR) — no host / filesystem / network access. The wired `value` input is exposed as `input`, the run variables as `vars`, and (JS only) a curated standard library as globals + `require()` (lodash/`_`, moment, uuid, nanoid, CryptoJS, Ajv). For JS the body runs as an async function, so a top-level `return` and `await` both work; the other languages return their last expression. Whatever the script returns flows out of `result`; `console.log` / `print` / `puts` / `cat` lines appear in the run log; a script error or timeout routes to `error`. External dependencies: pin packages via the box\'s Packages editor (`packages`) — pure-language packages only (Python: pure-Python wheels; a C-extension wheel is rejected on `error`). They are fetched + their transitive closure resolved on the first run, cached under the OS temp dir (`<os-temp>/restorm-code-deps`) and mounted offline on every later run.',
      config: { language: 'typescript | javascript | python | lua | ruby | r (default typescript).', code: 'Source for the chosen language — a body that returns/yields the result. Can also be supplied via the `code` input port (a wired script text wins over this inline value).', timeout: 'Execution budget in seconds (default 5, max 60).', packages: 'Pinned external dependencies as `[{ name, version }]` (exact versions — the cache key). Downloaded + cached on first run, loaded offline after. Pure-language packages only.' }
    }
  },
  cast: {
    labelKey: 'scenario.nodes.cast', defaultLabel: 'Cast', icon: 'replace', category: 'algorithmie',
    staticPreview: true,
    ports: { inputs: [{ id: 'value', name: 'value' }], outputs: [{ id: 'result', name: 'result', flow: 'both' }] },
    doc: {
      summary: 'Converts the `value` input (wired or inline) to `targetType` on `result`; an impossible cast (or a null value) routes to `error`. number↔boolean (0/1, truthiness), numeric/boolean string parsing, dates ISO; any → list wraps into [value].',
      config: { targetType: 'number | string | boolean | date | list', value: 'Inline value to cast (typed value) when not wired.' }
    }
  },
  regex: {
    labelKey: 'scenario.nodes.regex', defaultLabel: 'Regex', icon: 'regex', category: 'algorithmie',
    staticPreview: true,
    ports: { inputs: [{ id: 'value', name: 'value', dataType: 'string' }, { id: 'pattern', name: 'pattern', dataType: 'string' }], outputs: [{ id: 'result', name: 'result', flow: 'both' }] },
    doc: {
      summary: 'Runs `op` over the `value` string on `result`; an invalid pattern routes to `error`, a non-match is not an error. extract → first match (named-groups object | first group | whole match, else null); extractAll → list; test → boolean; replace → string (supports $1 / $<name>); split → list.',
      config: { op: 'extract | extractAll | test | replace | split', pattern: 'Regular-expression source.', flags: 'Flags i/m/s (g is implicit for extractAll/replace).', replacement: 'Replacement string (replace op).', value: 'Inline string when not wired.' }
    }
  },

  // --- Data formats (grouped into a "Data formats" submenu) ---
  json: {
    labelKey: 'scenario.nodes.json', defaultLabel: 'JSON', icon: 'json', category: 'dataFormats',
    staticPreview: true,
    ports: { inputs: [{ id: 'value', name: 'value' }], outputs: [{ id: 'result', name: 'result', flow: 'both' }] },
    doc: {
      summary: 'parse → the `value` JSON string into a value (malformed JSON → `error`; an already-structured value passes through); stringify → any `value` to a JSON string on `result` (`indent>0` pretty-prints; a circular / non-serialisable value → `error`).',
      config: { op: 'parse | stringify', indent: 'Pretty-print spaces for stringify (0 = compact, max 10).', value: 'Inline value when not wired (a JSON string for parse).' }
    }
  },
  xml: {
    labelKey: 'scenario.nodes.xml', defaultLabel: 'XML', icon: 'code', category: 'dataFormats',
    staticPreview: true,
    ports: { inputs: [{ id: 'value', name: 'value' }], outputs: [{ id: 'result', name: 'result', flow: 'both' }] },
    doc: {
      summary: 'parse → the `value` XML string into an object (attributes under `@_`; malformed XML → `error`; an already-structured value passes through); stringify → an object `value` to an XML string on `result` (`indent>0` pretty-prints).',
      config: { op: 'parse | stringify', indent: 'Pretty-print spaces for stringify (0 = single-line, max 10).', value: 'Inline value when not wired (an XML string for parse).' }
    }
  },
  yaml: {
    labelKey: 'scenario.nodes.yaml', defaultLabel: 'YAML', icon: 'symbol-structure', category: 'dataFormats',
    staticPreview: true,
    ports: { inputs: [{ id: 'value', name: 'value' }], outputs: [{ id: 'result', name: 'result', flow: 'both' }] },
    doc: {
      summary: 'parse → the `value` YAML string into a value (malformed YAML → `error`; an already-structured value passes through); stringify → any `value` to a YAML string on `result` (indented by `indent` spaces, 1–10).',
      config: { op: 'parse | stringify', indent: 'Indent spaces for stringify (1–10, default 2).', value: 'Inline value when not wired (a YAML string for parse).' }
    }
  },
  csv: {
    labelKey: 'scenario.nodes.csv', defaultLabel: 'CSV', icon: 'table', category: 'dataFormats',
    staticPreview: true,
    ports: { inputs: [{ id: 'value', name: 'value' }, { id: 'delimiter', name: 'delimiter', dataType: 'string' }], outputs: [{ id: 'result', name: 'result', flow: 'both' }] },
    doc: {
      summary: 'parse a CSV string → rows (objects when `header`, else cell arrays) / stringify a list → CSV. The wrong operand shape → `error`. The CSV member of the data-format family (json/xml/yaml).',
      config: { op: 'parse | stringify', delimiter: 'Field separator (default ",").', header: 'First row is a header → row-objects (default true).', value: 'Inline value when not wired.' }
    }
  },

  // --- Encoding (grouped into an "Encoding" submenu) ---
  crypto: {
    labelKey: 'scenario.nodes.crypto', defaultLabel: 'Crypto', icon: 'lock', category: 'encoding',
    staticPreview: true,
    ports: { inputs: [{ id: 'value', name: 'value', dataType: 'string' }], outputs: [{ id: 'result', name: 'result', dataType: 'string', flow: 'both' }] },
    doc: {
      summary: 'Transforms the `value` string on `result`: base64Encode/base64Decode, md5/sha1/sha256/sha512 (hex digest), hmacSha256 (keyed, hex), uuid (a fresh v4, ignores value). A missing HMAC key or a non-UTF-8 base64Decode → `error`.',
      config: { op: 'base64Encode | base64Decode | md5 | sha1 | sha256 | sha512 | hmacSha256 | uuid', key: 'Secret key (hmacSha256 only).', value: 'Inline string when not wired.' }
    }
  },
  jwt: {
    labelKey: 'scenario.nodes.jwt', defaultLabel: 'JWT', icon: 'key', category: 'encoding',
    staticPreview: true,
    ports: { inputs: [{ id: 'value', name: 'value', dataType: 'string' }], outputs: [{ id: 'result', name: 'result', flow: 'both' }] },
    doc: {
      summary: 'Decodes the `value` JWT/JWS token string into `{ header, payload, signature }` on `result` (signature is the raw segment, NOT verified). A non-string or malformed token → `error`.',
      config: { value: 'Inline token string when not wired.' }
    }
  },
  url: {
    labelKey: 'scenario.nodes.url', defaultLabel: 'URL', icon: 'link', category: 'encoding',
    staticPreview: true,
    ports: { inputs: [{ id: 'value', name: 'value' }], outputs: [{ id: 'result', name: 'result', flow: 'both' }] },
    doc: {
      summary: 'encode/decode a URI component, parseQuery (string → object) / buildQuery (object → string), or parseUrl (→ { protocol, hostname, port, pathname, search, hash, origin, query }). A malformed escape / non-object buildQuery / bad URL → `error`.',
      config: { op: 'encode | decode | parseQuery | buildQuery | parseUrl', value: 'Inline value when not wired.' }
    }
  },

  // --- UX (grouped into a "UX" submenu) ---
  toast: {
    labelKey: 'scenario.nodes.toast', defaultLabel: 'Toast', icon: 'bell', category: 'ux',
    ports: { inputs: [{ id: 'title', name: 'title', dataType: 'string' }, { id: 'message', name: 'message', dataType: 'string' }], outputs: [] },
    doc: {
      summary: 'Emits a toast notification in the Restorm UI (renderer). The `level` drives the toast glyph + colour. Headless / CLI: no-op — the run still succeeds and `done` is emitted. Sequence it via the `in` trigger.',
      config: { title: 'Header text (typed value; or wire `title`).', message: 'Body text below the title (typed value; or wire `message`).', level: 'info (default) | success | warning | error', duration: 'Auto-dismiss after this many SECONDS. 0 (or unset) → the toast persists until dismissed.' }
    }
  },

  // --- Utilities ---
  random: {
    labelKey: 'scenario.nodes.random', defaultLabel: 'Random', icon: 'wand', category: 'utility',
    staticPreview: true,
    ports: { inputs: [{ id: 'min', name: 'min', dataType: 'number' }, { id: 'max', name: 'max', dataType: 'number' }, { id: 'seed', name: 'seed' }], outputs: [{ id: 'result', name: 'result', flow: 'both' }] },
    doc: {
      summary: 'Generates a value on `result`: int/float in [min,max], string of `length`, boolean, or pick from a list. A `seed` (number or string) makes it deterministic. `pick` over an empty list → `error`. No data input.',
      config: { op: 'int | float | string | boolean | pick', min: 'Range min (int/float).', max: 'Range max (int/float).', length: 'String length.', seed: 'Optional seed for reproducible output.', items: 'List to pick from (pick op).' }
    }
  },
  schema: {
    labelKey: 'scenario.nodes.schema', defaultLabel: 'Schema validate', icon: 'checklist', category: 'utility',
    staticPreview: true,
    ports: { inputs: [{ id: 'value', name: 'value' }, { id: 'schema', name: 'schema', dataType: 'string' }], outputs: [{ id: 'valid', name: 'valid', role: 'then', flow: 'both' }, { id: 'invalid', name: 'invalid', role: 'else', flow: 'both' }, { id: 'errors', name: 'errors', flow: 'both' }] },
    doc: {
      summary: 'Validates `value` against a JSON Schema (ajv) → routes the value to `valid` / `invalid` and emits the error list on `errors`. A malformed / missing schema → `error`.',
      config: { schema: 'JSON Schema (a JSON string; draft-07 / 2019-09 / 2020-12).', value: 'Inline value to validate when not wired.' }
    }
  },
  readFile: {
    labelKey: 'scenario.nodes.readFile', defaultLabel: 'Read file', icon: 'file', category: 'utility',
    ports: { inputs: [{ id: 'path', name: 'path', dataType: 'string' }], outputs: [{ id: 'content', name: 'content', dataType: 'string', flow: 'both' }] },
    doc: {
      summary: 'Reads the file at `path` → its text on `content`. `path` is absolute, or relative to the open `.restorm` file. A missing path / read error → `error`.',
      config: { path: 'File path (absolute or relative to the scenario); or wire `path`.' }
    }
  },
  writeFile: {
    labelKey: 'scenario.nodes.writeFile', defaultLabel: 'Write file', icon: 'save', category: 'utility',
    ports: { inputs: [{ id: 'path', name: 'path', dataType: 'string' }, { id: 'content', name: 'content' }], outputs: [] },
    doc: {
      summary: 'Writes (replace) or appends `content` to the file at `path`. `path` is absolute, or relative to the open `.restorm` file. Terminal (no value output). A missing path / write error → `error`.',
      config: { path: 'File path (absolute or relative to the scenario); or wire `path`.', mode: 'replace (default) | append.', content: 'Text to write (typed value; or wire `content`).' }
    }
  },
  log: {
    labelKey: 'scenario.nodes.log', defaultLabel: 'Log', icon: 'output', category: 'utility',
    ports: { inputs: [{ id: 'message', name: 'message', dataType: 'string' }, { id: 'data', name: 'data' }], outputs: [] },
    doc: {
      summary: 'Writes one entry to the run log (visible via get_scenario_run_status + the inspector panel) and passes the value through. Sequence it via the `in` trigger.',
      config: { level: 'debug | info | warn | error', message: 'Text (typed value).', data: 'Optional structured payload (or wire `data`).' }
    }
  },
  assert: {
    labelKey: 'scenario.nodes.assert', defaultLabel: 'Assert', icon: 'verified', category: 'utility',
    ports: { inputs: [{ id: 'a', name: 'actual' }, { id: 'b', name: 'expected' }, { id: 'message', name: 'message', dataType: 'string' }], outputs: [{ id: 'then', name: 'pass', role: 'then', flow: 'both' }, { id: 'else', name: 'fail', role: 'else', flow: 'both' }] },
    doc: {
      summary: 'Asserts `actual` (vs `expected`) with `operator`, routing the trigger to `then` (pass) or `else` (fail). Beyond the shared comparators, chai-style operators: type checks, presence/emptiness, regex match, membership, deep equality and length.',
      config: { operator: 'eq | ne | lt | lte | gt | gte | contains | isString | isNumber | isBoolean | isArray | isObject | isNull | exists | isEmpty | matchesRegex | isOneOf | deepEquals | lengthEq | lengthGt | lengthLt', a: 'Actual operand (or wire `a`).', b: 'Expected operand / pattern / list / length (binary operators).', message: 'Failure label.' }
    }
  },
  throw: {
    labelKey: 'scenario.nodes.throw', defaultLabel: 'Throw', icon: 'error', category: 'utility',
    hasDonePort: false,
    ports: { inputs: [{ id: 'message', name: 'message', dataType: 'string' }], outputs: [] },
    doc: {
      summary: 'Deliberately fails with `message` (wired or inline) — routed to the implicit `error` port, or fails the run if nothing handles it. For error branches + retry tests. No `done`/value output.',
      config: { message: 'Failure message (typed value; or wire `message`).' }
    }
  }
} satisfies Record<string, KindSpec>

/**
 * The scenario node kind union, inverted from the registry keys — the registry
 * is the single source of truth for the kind LIST. Adding a key above widens
 * this union (and, via the derivations below + the drift-guard test, every
 * dependent list) automatically.
 */
export type ScenarioNodeKind = keyof typeof SCENARIO_KIND_REGISTRY

/** Every kind, in registry (= catalogue display) order. */
export const SCENARIO_KINDS = Object.keys(SCENARIO_KIND_REGISTRY) as [ScenarioNodeKind, ...ScenarioNodeKind[]]

/** Type-narrowed registry view (the `satisfies` above keeps the literal keys; this
 * exposes it typed as the exhaustive record for value-level consumers). */
export const REGISTRY: Record<ScenarioNodeKind, KindSpec> = SCENARIO_KIND_REGISTRY

/** The spec for a kind. */
export function kindSpec(kind: ScenarioNodeKind): KindSpec {
  return SCENARIO_KIND_REGISTRY[kind]
}
