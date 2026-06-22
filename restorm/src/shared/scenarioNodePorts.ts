import type { ScenarioNodeKind, ScenarioPort, ScenarioDataType, ScenarioPortRole, PortFlow, Scenario } from './types/collections'
import { readInputParams } from './scenarioInputParams'
import { readOutputDecls } from './scenarioOutputDecls'
import { acceptsInputEvent } from './scenarioNodeCapabilities'
import { LIST_MUTATION_DEFAULT_VALUE_ID } from './scenarioListMutationValues'

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

/** Generic header launch trigger — a `signal` input (accepts B/AB). Stamped
 * centrally by {@link defaultPortsForKind} for every kind that
 * {@link acceptsInputEvent}, so it is NOT listed per-kind below. */
const IN: PortSpec = { id: 'in', flow: 'signal' }
/** Generic output — carries a value AND acts as a trigger (`both`). */
const OUT: PortSpec = { id: 'out', flow: 'both' }

// The header `in` trigger is no longer listed per entry: `defaultPortsForKind`
// prepends it for every kind that `acceptsInputEvent` (the default — every kind
// except the `output` sink). So a spec's `inputs` here lists ONLY the kind's
// own data/value inputs; the launch trigger is the capability's business.
const PORTS: Partial<Record<ScenarioNodeKind, KindPorts>> = {
  // Sources & control
  input: { inputs: [], outputs: [{ id: 'value', name: 'value', flow: 'both' }] },
  // `output` — declares a named scenario output (the symmetric counterpart of
  // `input`): it consumes a `value` and exposes it as one of the scenario's
  // outputs, which a parent `runScenario` derives into an output port. A
  // terminal sink — no output of its own, and the SOLE kind with no header
  // trigger (see `acceptsInputEvent`).
  output: { inputs: [{ id: 'value', name: 'value' }], outputs: [] },
  if: { inputs: [{ id: 'left', name: 'left' }, { id: 'right', name: 'right' }], outputs: [{ id: 'then', name: 'then', role: 'then', flow: 'both' }, { id: 'else', name: 'else', role: 'else', flow: 'both' }] },
  switch: { inputs: [{ id: 'on', name: 'on' }], outputs: [{ id: 'default', name: 'default', role: 'default', flow: 'both' }] },
  // Requests & composition
  // `requestOverride` accepts a whole-request patch `{ url?, method?, headers?, body? }`
  // merged over the bound request before dispatch (used by an upstream Postman/Bruno
  // pre-request `code` node that mutated `pm.request` / `req`).
  httpRequest: { inputs: [{ id: 'env', name: 'env', flow: 'value' }, { id: 'requestOverride', name: 'override', dataType: 'object', flow: 'value' }], outputs: [{ id: 'response', name: 'response', dataType: 'response', role: 'response', flow: 'both' }] },
  runScenario: { inputs: [], outputs: [{ id: 'result', name: 'result', role: 'response', flow: 'both' }] },
  // Socket.IO connect: a long-lived listener. `connected` fires once the socket
  // is open (a pure signal). Each listened event re-emits on its OWN derived
  // port (`event:<name>` — switch-like, added from `config.events`); any other
  // server-pushed event lands on the `others` catch-all (the switch `default`
  // analogue). The connection stays open until a `socketioClose` (or a Stop)
  // ends it, at which point the universal `done` port fires. The per-event ports
  // are derived (see {@link socketioConnectEventPorts}), not stamped here.
  socketioConnect: { inputs: [], outputs: [{ id: 'connected', name: 'connected', flow: 'signal' }, { id: 'others', name: 'others', role: 'default', flow: 'both' }] },
  // Socket.IO send: a pure-event action. Triggered on `in`, it emits `payload`
  // on the `channel` event of the connection named by `config.connectionNodeId`.
  // Sequencing happens via the universal `done` port (there's no separate value
  // output — the action's outcome IS its completion). Both `channel` and
  // `payload` carry inline fallbacks, so they aren't hard-required.
  socketioSend: { inputs: [{ id: 'channel', name: 'channel', dataType: 'string' }, { id: 'payload', name: 'payload' }], outputs: [] },
  // Socket.IO close: a pure-event action. Triggered on `in`, it closes the
  // connection named by `config.connectionNodeId` (firing that connect node's
  // `done`). Sequencing happens via the universal `done` port.
  socketioClose: { inputs: [], outputs: [] },
  // Raw WebSocket connect: like socketioConnect but a raw WS has no named events,
  // so every received frame re-emits on a SINGLE `message` port (no `event:<name>`
  // derivation, no `others`). `connected` fires once open; `done` fires on close.
  websocketConnect: { inputs: [], outputs: [{ id: 'connected', name: 'connected', flow: 'signal' }, { id: 'message', name: 'message', flow: 'both' }] },
  // Raw WebSocket send: sends `payload` (text) on the connection named by
  // `config.connectionNodeId` — no channel/event. Sequences via `done`.
  websocketSend: { inputs: [{ id: 'payload', name: 'payload' }], outputs: [] },
  // Raw WebSocket close: closes the named connection. Sequences via `done`.
  websocketClose: { inputs: [], outputs: [] },
  // MQTT connect: like websocketConnect — MQTT has no named events, so every
  // received message re-emits on a SINGLE `message` port. `connected` fires once
  // the broker accepts + the topic is subscribed; `done` fires on close.
  mqttConnect: { inputs: [], outputs: [{ id: 'connected', name: 'connected', flow: 'signal' }, { id: 'message', name: 'message', flow: 'both' }] },
  // MQTT publish: publishes `payload` on the connection named by
  // `config.connectionNodeId` (to that connection's topic). Sequences via `done`.
  mqttSend: { inputs: [{ id: 'payload', name: 'payload' }], outputs: [] },
  // MQTT close: closes the named connection. Sequences via `done`.
  mqttClose: { inputs: [], outputs: [] },
  // gRPC streaming connect: like websocketConnect — a streaming RPC has no named
  // events, so every received frame re-emits on a SINGLE `message` port.
  // `connected` fires once the call opens; `done` fires when the stream ends.
  grpcConnect: { inputs: [], outputs: [{ id: 'connected', name: 'connected', flow: 'signal' }, { id: 'message', name: 'message', flow: 'both' }] },
  // gRPC send: writes `payload` (a request message) on the connection named by
  // `config.connectionNodeId` (client / bidi) — no channel. Sequences via `done`.
  grpcSend: { inputs: [{ id: 'payload', name: 'payload' }], outputs: [] },
  // gRPC close: half-closes the named streaming call. Sequences via `done`.
  grpcClose: { inputs: [], outputs: [] },
  // Iteration & collections. `items` carries a value-selector fallback in the
  // editor (list-typed sources), so it isn't a hard-required port — like the
  // `if` operands; the editor flags it red only when no list type is available.
  // Loop completion is the universal implicit `Done` port (drawn on every box),
  // so no explicit `done` output here — it would be a duplicate.
  forEach: { inputs: [{ id: 'items', name: 'items', dataType: 'json' }], outputs: [{ id: 'each', name: 'each', role: 'then', flow: 'both' }] },
  // `items` has a value-selector fallback in the editor (like forEach), so it
  // isn't a hard-required port; the editor flags it red only when no list type
  // is available to pick.
  aggregate: { inputs: [{ id: 'items', name: 'items', dataType: 'json' }], outputs: [{ id: 'result', name: 'result', flow: 'both' }] },
  // `items` has a value-selector fallback (like forEach); the per-item
  // transform lives in config.
  map: { inputs: [{ id: 'items', name: 'items', dataType: 'json' }], outputs: [{ id: 'mapped', name: 'mapped', dataType: 'json', flow: 'both' }] },
  // `items` has a value-selector fallback in the editor (like forEach), so it
  // isn't a hard-required port; the predicate (field/operator/value) lives in
  // config.
  filter: { inputs: [{ id: 'items', name: 'items', dataType: 'json' }], outputs: [{ id: 'kept', name: 'kept', dataType: 'json', flow: 'both' }, { id: 'rejected', name: 'rejected', dataType: 'json', flow: 'both' }] },
  // List mutation: `list` is the target collection (a list-typed source/variable,
  // value-selector fallback). The values to add/remove are N per-row inputs (each
  // its own connectable port, derived from config like the object node's
  // properties — not listed here). `result` is the new list.
  // `list` is the list-only TARGET (a list-typed variable or a wired list — a
  // plain `object` can't land here). The default value-row port is declared
  // (dataType `any`) so a dragged value/object lands on it rather than `list`
  // (the box renders it as the first value row when none are persisted yet).
  addToList: { inputs: [{ id: 'list', name: 'list', dataType: 'list' }, { id: LIST_MUTATION_DEFAULT_VALUE_ID, name: '', dataType: 'any' }], outputs: [{ id: 'result', name: 'result', dataType: 'json', flow: 'both' }] },
  removeFromList: { inputs: [{ id: 'list', name: 'list', dataType: 'list' }, { id: LIST_MUTATION_DEFAULT_VALUE_ID, name: '', dataType: 'any' }], outputs: [{ id: 'result', name: 'result', dataType: 'json', flow: 'both' }] },
  // Loops. `for` is a numeric-range forEach: `from` / `to` / `step` carry
  // inline value fallbacks (like the `if` operands), so they aren't hard
  // required; it fans out the range over `each` (the current number) and fires
  // `done` once every iteration's scope has closed — reusing the forEach
  // scope machinery + the parallelism control.
  for: { inputs: [{ id: 'from', name: 'from', dataType: 'number' }, { id: 'to', name: 'to', dataType: 'number' }, { id: 'step', name: 'step', dataType: 'number' }], outputs: [{ id: 'each', name: 'index', role: 'then', flow: 'both' }] },
  // `while` / `doWhile` are the `if` mechanism in a loop dress: the header
  // trigger + two operands compared by the operator toggle, routing to `then`
  // (the loop body) when the condition holds and `else` (exit) when it fails.
  // The loop is closed by a user-wired edge from the body back into `in` (or
  // an operand) — the scheduler's merge-on-loop-back re-fires the node each
  // pass. `while` tests at the top; `doWhile` is wired after the body so it
  // runs at least once. The `then` label differs to hint the wiring.
  // Loop exit ("once the condition lets us out") is the universal implicit
  // `Done` port — no explicit `else`/`done` output here (it would duplicate it).
  // The body branch (`then`) is a pure SIGNAL — it just fires the loop body each
  // pass; there's no per-iteration value to carry (unlike a forEach `each` item).
  while: { inputs: [{ id: 'left', name: 'left' }, { id: 'right', name: 'right' }], outputs: [{ id: 'then', name: 'body', role: 'then', flow: 'signal' }] },
  doWhile: { inputs: [{ id: 'left', name: 'left' }, { id: 'right', name: 'right' }], outputs: [{ id: 'then', name: 'loop', role: 'then', flow: 'signal' }] },
  // Time. No explicit output — `wait` sequences the next node via the universal
  // `done` port (which fires once the delay elapses). A value to carry past the
  // delay is held in a run variable / wired around the wait, not passed through.
  wait: { inputs: [{ id: 'duration', name: 'duration', dataType: 'duration' }], outputs: [] },
  // Aligned on `wait`: an inline value fallback (a date-time picker) on `until`,
  // so it isn't a hard-required port and the node is runnable on its own.
  // Sequences via `done` (no value passthrough), like `wait`.
  waitUntil: { inputs: [{ id: 'until', name: 'until' }], outputs: [] },
  now: { inputs: [], outputs: [{ id: 'value', name: 'now', dataType: 'string', flow: 'both' }] },
  // `timer` fires its `tick` body on each interval (a frequency number+unit OR a
  // cron), optionally bounded by a total duration / end date, until it stops.
  // The frequency, cron, duration and endDate are all wireable inputs.
  timer: { inputs: [{ id: 'frequency', name: 'frequency', dataType: 'number' }, { id: 'cron', name: 'cron', dataType: 'string' }, { id: 'duration', name: 'duration', dataType: 'number' }, { id: 'endDate', name: 'endDate' }], outputs: [{ id: 'tick', name: 'tick', role: 'then', flow: 'both' }] },
  // Data & compute. Operands carry typed value-selector fallbacks (like `if`),
  // so they aren't hard-required ports. These are data-driven (they run once
  // their inputs resolve and expose `result`), but they still carry the header
  // trigger so a flow can gate WHEN they (re)compute / re-read a variable.
  arithmetic: { inputs: [{ id: 'a', name: 'a', dataType: 'number' }, { id: 'b', name: 'b', dataType: 'number' }], outputs: [{ id: 'result', name: 'result', dataType: 'number', flow: 'both' }] },
  comparator: { inputs: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }], outputs: [{ id: 'result', name: 'result', dataType: 'boolean', flow: 'both' }] },
  // `object` builds a structured object from N named properties. The property
  // inputs are user-configured (rendered from config like the switch cases), so
  // none are stamped here; the single output is the assembled JSON object.
  object: { inputs: [], outputs: [{ id: 'object', name: 'object', dataType: 'object', flow: 'both' }] },
  boolean: { inputs: [{ id: 'a', name: 'a', dataType: 'boolean' }, { id: 'b', name: 'b', dataType: 'boolean' }], outputs: [{ id: 'result', name: 'result', dataType: 'boolean', flow: 'both' }] },
  // No `event` output — completion is the universal `Done` port (which made the
  // old `event` signal redundant).
  setVariable: { inputs: [{ id: 'value', name: 'value' }], outputs: [] },
  getVariable: { inputs: [], outputs: [{ id: 'value', name: 'value', flow: 'both' }] },
  // `transform` (a.k.a. "Transform template") applies an expression/Handlebars
  // template to its optional `value` input and emits the result. The `value`
  // input stays optional so the node can also run on its own (a pure template).
  // The `expression` input is also optional: wire it to drive the template text
  // from an upstream value, else the inline editor's template is used. The
  // expression determines the output type.
  transform: { inputs: [{ id: 'value', name: 'value' }, { id: 'expression', name: 'expression' }], outputs: [{ id: 'out', name: 'value', flow: 'both' }] },
  // `code` runs user TS/JS: its `value` input is exposed as `input`, the script's
  // return value flows out of `result`. The `code` input lets the SCRIPT TEXT
  // itself be wired (an upstream node can supply the code); unwired, the inline
  // editor's code is used.
  code: { inputs: [{ id: 'value', name: 'input' }, { id: 'code', name: 'code', dataType: 'string' }], outputs: [{ id: 'result', name: 'result', flow: 'both' }] },
  // `cast` converts its `value` input to the configured target type (the output
  // type is the chosen target, so no fixed dataType is stamped here).
  cast: { inputs: [{ id: 'value', name: 'value' }], outputs: [{ id: 'result', name: 'result', flow: 'both' }] },
  // `regex` runs the configured operation (extract / match / replace / split)
  // over its `value` string input; the output type depends on the op.
  regex: { inputs: [{ id: 'value', name: 'value', dataType: 'string' }, { id: 'pattern', name: 'pattern', dataType: 'string' }], outputs: [{ id: 'result', name: 'result', flow: 'both' }] },
  // `json` parses its `value` string into a value, or stringifies its `value`;
  // the output type depends on the op (parsed value vs JSON string).
  json: { inputs: [{ id: 'value', name: 'value' }], outputs: [{ id: 'result', name: 'result', flow: 'both' }] },
  // `xml` / `yaml` parse their `value` string into a value, or stringify their
  // `value`; the output type depends on the op (parsed value vs markup string).
  xml: { inputs: [{ id: 'value', name: 'value' }], outputs: [{ id: 'result', name: 'result', flow: 'both' }] },
  yaml: { inputs: [{ id: 'value', name: 'value' }], outputs: [{ id: 'result', name: 'result', flow: 'both' }] },
  // `crypto` encodes / hashes / signs its `value` string (or generates a UUID);
  // the result is always a string.
  crypto: { inputs: [{ id: 'value', name: 'value', dataType: 'string' }], outputs: [{ id: 'result', name: 'result', dataType: 'string', flow: 'both' }] },
  // `jwt` decodes its `value` token string into `{ header, payload, signature }`.
  jwt: { inputs: [{ id: 'value', name: 'value', dataType: 'string' }], outputs: [{ id: 'result', name: 'result', flow: 'both' }] },
  // `datetime` shifts / formats / diffs its `value` date; output is an ISO string
  // (add / subtract / format) or a number (diff). The `amount` (add/subtract) and
  // `other` second date (diff) are optional inputs: wire them, else use the inline
  // fields.
  datetime: { inputs: [{ id: 'value', name: 'value' }, { id: 'amount', name: 'amount' }, { id: 'other', name: 'other' }], outputs: [{ id: 'result', name: 'result', flow: 'both' }] },
  // `objectOp` reshapes its `value` object (get/set/merge/pick/omit/keys/values);
  // path / keys / the set-or-merge operand live in config.
  objectOp: { inputs: [{ id: 'value', name: 'value' }, { id: 'path', name: 'path', dataType: 'string' }], outputs: [{ id: 'result', name: 'result', flow: 'both' }] },
  // `url` encodes / decodes / parses / builds its `value` (a string, or an object
  // for buildQuery); the output type depends on the op.
  url: { inputs: [{ id: 'value', name: 'value' }], outputs: [{ id: 'result', name: 'result', flow: 'both' }] },
  // `random` generates a value (int / float / string / boolean / pick) — no data
  // input; every parameter is config.
  random: { inputs: [{ id: 'min', name: 'min', dataType: 'number' }, { id: 'max', name: 'max', dataType: 'number' }, { id: 'seed', name: 'seed' }], outputs: [{ id: 'result', name: 'result', flow: 'both' }] },
  // `listOp` reshapes its `value` list (sort/unique/reverse/flatten/chunk/slice/
  // groupBy); the key / order / size / bounds live in config.
  listOp: { inputs: [{ id: 'value', name: 'value', dataType: 'list' }, { id: 'key', name: 'key', dataType: 'string' }], outputs: [{ id: 'result', name: 'result', flow: 'both' }] },
  // `csv` parses a CSV string → rows / stringifies a list → CSV; delimiter +
  // header are config. Like json/xml/yaml the `value` shape depends on the op.
  csv: { inputs: [{ id: 'value', name: 'value' }, { id: 'delimiter', name: 'delimiter', dataType: 'string' }], outputs: [{ id: 'result', name: 'result', flow: 'both' }] },
  // `math` runs a scalar op on `a`; the second operand (min/max), clamp bounds
  // and round precision live in config.
  math: { inputs: [{ id: 'a', name: 'a', dataType: 'number' }, { id: 'precision', name: 'precision', dataType: 'number' }], outputs: [{ id: 'result', name: 'result', dataType: 'number', flow: 'both' }] },
  // `schema` validates `value` against a JSON Schema → routes the value to
  // `valid` / `invalid` + the error list on `errors`.
  schema: { inputs: [{ id: 'value', name: 'value' }, { id: 'schema', name: 'schema', dataType: 'string' }], outputs: [{ id: 'valid', name: 'valid', role: 'then', flow: 'both' }, { id: 'invalid', name: 'invalid', role: 'else', flow: 'both' }, { id: 'errors', name: 'errors', flow: 'both' }] },
  // `readFile` reads the file at `path` (relative to the scenario, or absolute)
  // → its text on `content`.
  readFile: { inputs: [{ id: 'path', name: 'path', dataType: 'string' }], outputs: [{ id: 'content', name: 'content', dataType: 'string', flow: 'both' }] },
  // `writeFile` writes / appends `content` to `path`. Terminal (no value output).
  writeFile: { inputs: [{ id: 'path', name: 'path', dataType: 'string' }, { id: 'content', name: 'content' }], outputs: [] },
  // `retry` runs the body wired off `attempt` as an error-boundary scope; the
  // implicit `done` is the success exit, `exhausted` the give-up branch.
  retry: { inputs: [{ id: 'maxAttempts', name: 'maxAttempts', dataType: 'number' }, { id: 'delay', name: 'delay', dataType: 'number' }], outputs: [{ id: 'attempt', name: 'attempt', role: 'then', flow: 'both' }, { id: 'exhausted', name: 'exhausted', role: 'else', flow: 'both' }] },
  // Utilities
  // A terminal sink with two optional inputs (wire either, or set inline).
  // `message` is a string, `data` any value. No output (terminal).
  log: { inputs: [{ id: 'message', name: 'message', dataType: 'string' }, { id: 'data', name: 'data' }], outputs: [] },
  // An assertion compares two operands (`actual` / `expected`) with the same
  // operator toggle as `if`/`comparator`; both operands carry inline
  // value-selector fallbacks, so they aren't hard-required ports. Branches
  // `pass` / `fail`; the failure label lives in config (`message`).
  assert: { inputs: [{ id: 'a', name: 'actual' }, { id: 'b', name: 'expected' }, { id: 'message', name: 'message', dataType: 'string' }], outputs: [{ id: 'then', name: 'pass', role: 'then', flow: 'both' }, { id: 'else', name: 'fail', role: 'else', flow: 'both' }] },
  // `toast` broadcasts a notification to the Restorm UI (renderer). Wireable /
  // inline text inputs: `title` (header) + `message` (body). `level` (info /
  // success / warning / error, a segmented toggle) and `duration` (a plain
  // number of seconds) are config-only — not wireable ports. No value output —
  // emits `done` implicitly via the capability default, and the implicit `error`
  // port (a title/message expression can fail to render).
  toast: { inputs: [{ id: 'title', name: 'title', dataType: 'string' }, { id: 'message', name: 'message', dataType: 'string' }], outputs: [] },
  // `throw` deliberately fails with a `message` (wired or inline) — routed to the
  // node's implicit `error` port (or it fails the run if nothing handles it). No
  // value output: a throw never completes normally.
  throw: { inputs: [{ id: 'message', name: 'message', dataType: 'string' }], outputs: [] }
}

/** A generic single-in/single-out node for any kind without a spec (the `in`
 * trigger is added by {@link defaultPortsForKind}, so only the output here). */
const FALLBACK: KindPorts = { inputs: [], outputs: [OUT] }

/** Fresh default ports for a node of the given kind (new arrays each call). The
 * header `in` launch trigger is prepended for every kind that
 * {@link acceptsInputEvent} — i.e. all but the `output` sink. */
export function defaultPortsForKind(kind: ScenarioNodeKind): { inputs: ScenarioPort[]; outputs: ScenarioPort[] } {
  const spec = PORTS[kind] ?? FALLBACK
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
