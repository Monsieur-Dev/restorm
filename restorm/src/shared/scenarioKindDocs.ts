import type { ScenarioNodeKind } from './types/scenario'

/**
 * Human/agent-facing documentation for every scenario node kind — the
 * data behind the `describe_scenario_kinds` MCP tool, so a client can
 * author a scenario graph correctly without trial-and-error. Ports come
 * from {@link defaultPortsForKind}; this adds the *semantics* a port list
 * can't convey: what the box does and which `config` keys it reads.
 *
 * The `Record<ScenarioNodeKind, …>` is exhaustive — TypeScript rejects a
 * new kind until it is documented here.
 */
export interface ScenarioKindDoc {
  /** One-line purpose. */
  summary: string
  /** Per-`config`-key meaning (the per-kind config bag passed to create_scenario_node / update_scenario_node). */
  config?: Record<string, string>
}

/**
 * Documentation for every typed-value shape a node `config` (or an input's
 * `valueType`) can carry — the `{ type, … }` objects that flow through ports.
 * A scenario `config` accepts a free-form bag, so these are not schema-enforced;
 * this is the reference an MCP client needs to author them without reading
 * source. Surfaced by `describe_scenario_kinds` alongside the kind catalogue.
 *
 * Keyed by the literal `type` discriminator (the union in `valuePersistence.ts`).
 */
export const VALUE_TYPE_DOCS: Record<string, { shape: string; summary: string }> = {
  string: { shape: '{ type: "string", value: "<text>" }', summary: 'A plain text value.' },
  numeric: { shape: '{ type: "numeric", value: 42, format: "decimal" }', summary: 'A number. `format` is a display hint (e.g. decimal).' },
  boolean: { shape: '{ type: "boolean", value: true }', summary: 'A boolean.' },
  datetime: { shape: '{ type: "datetime", value: "<ISO-8601>", format: "<fmt>" }', summary: 'A date/time (ISO string).' },
  color: { shape: '{ type: "color", value: "#rrggbb" }', summary: 'A colour (hex string).' },
  expression: { shape: '{ type: "expression", value: "{{handlebars}}" }', summary: 'A Handlebars template rendered at runtime against inputs + run variables.' },
  password: { shape: '{ type: "password" }', summary: 'A secret/password value (the secret itself is held out-of-band, not in the graph).' },
  null: { shape: '{ type: "null" }', summary: 'The null value. Equal only to another null (no coercion).' },
  list: { shape: '{ type: "list", items: [ <PersistedValue>, … ] }', summary: 'An agnostic, untyped list — an array of any typed values (lists can nest).' },
  enum: { shape: '{ type: "enum", value: "<option>", enumDefinitionId: "<id>" }', summary: 'A single pick from an enum definition.' },
  enumList: { shape: '{ type: "enumList", value: ["a","b"], enumDefinitionId: "<id>" }', summary: 'A multi-pick from an enum → resolves to a real array.' },
  customList: { shape: '{ type: "customList", listId: "<id>", label: "<picked>" }', summary: 'A single pick from a user-defined value list.' },
  customListMulti: { shape: '{ type: "customListMulti", listId: "<id>", labels: ["a","b"] }', summary: 'A multi-pick from a user-defined value list → resolves to a real array.' },
  variable: { shape: '{ type: "variable", value: "<name>" }', summary: 'A reference to a run variable (declared by an input/setVariable); read live at runtime.' },
  environment: { shape: '{ type: "environment", value: "<environmentId>" }', summary: 'The selected environment; an empty / unresolvable id resolves to null.' }
}

export const SCENARIO_KIND_DOCS: Record<ScenarioNodeKind, ScenarioKindDoc> = {
  input: {
    summary: 'Declares a named scenario input/param. Seeded at run start from run_scenario params; prompts the user mid-run if reached without a value.',
    config: { name: 'Param name (the key callers pass).', valueType: 'Typed default value `{ type, value }` used when no param is supplied.' }
  },
  output: {
    summary: 'Declares a named scenario output. Consumes a value and exposes it as one of the scenario\'s results (a parent runScenario reads it as `output:<name>`).',
    config: { name: 'Output name.' }
  },
  if: {
    summary: 'Branch: compares two operands with `operator`, routing the trigger value to `then` (true) or `else` (false). With no operands wired, falls back to the truthiness of the `in` signal.',
    config: { operator: 'lt | lte | eq | gte | gt | ne | contains', left: 'Left operand (typed value; or wire the `left` port).', right: 'Right operand (typed value; or wire the `right` port).' }
  },
  switch: {
    summary: 'N-way branch: matches the `on` input against the case values; emits on `case-<id>` for a match, else on `default`.',
    config: { cases: 'Array of `{ id, value }`; each gets a `case-<id>` output port.' }
  },
  httpRequest: {
    summary: 'Runs a bound API request (REST/GraphQL/gRPC/WebSocket) and emits its `response`. Sequence it via the `in` trigger.',
    config: { requestId: 'Id of the request item to execute.', label: 'Display label on the box.' }
  },
  runScenario: {
    summary: 'Runs another scenario as a sub-scenario. Wired `param:<name>` inputs feed its inputs; emits `output:<name>` per output node, plus `done` when it has none.',
    config: { scenarioId: 'Id of the scenario to run.', label: 'Display label on the box.' }
  },
  forEach: {
    summary: 'Iterates a collection: fans out `each` item, then fires `done` once every iteration\'s sub-graph has finished. `items` is wired or taken from a configured list.',
    config: { parallelism: '`{ enabled, count }` — bounded concurrent iterations (count≥2). Off = sequential.' }
  },
  for: {
    summary: 'Numeric-range forEach: `for i = from; i <operator> to; i += step` — fans out each `i` on `each`, then `done`. Inputs override config.',
    config: { from: 'Range start (number).', to: 'Loop bound (number).', operator: 'Comparison vs `to`: < (default) | ≤ | = | ≥ | > | ≠.', step: 'Signed increment (0 → 1).', parallelism: '`{ enabled, count }` like forEach.' }
  },
  while: {
    summary: 'Loop (test-first): the `if` mechanism — routes to `then` (body) while the condition holds, else `done`. Close the loop by wiring the body back into `in` (or an operand); the engine re-fires on each pass.',
    config: { operator: 'lt | lte | eq | gte | gt | ne | contains', left: 'Left operand (or wire `left`).', right: 'Right operand (or wire `right`).' }
  },
  doWhile: {
    summary: 'Loop (body-first): same `if` mechanism as `while`, but placed AFTER the body so it runs at least once. `then` loops back to the body, `else` exits.',
    config: { operator: 'lt | lte | eq | gte | gt | ne | contains', left: 'Left operand (or wire `left`).', right: 'Right operand (or wire `right`).' }
  },
  aggregate: {
    summary: 'Reduces a collection to a single `result` (count/sum/min/max/average/join).',
    config: { op: 'count | sum | min | max | average | join', field: 'Optional item field to read before reducing.', separator: 'Join separator (op=join).' }
  },
  map: {
    summary: 'Transforms each item of a collection, emitting the new list on `mapped`.',
    config: { property: 'Item field to pick.', expression: 'Optional Handlebars template applied per item.' }
  },
  filter: {
    summary: 'Partitions a collection by a predicate: matches on `kept`, non-matches on `rejected` (so dropped items can be routed, not lost).',
    config: { property: 'Item field to test.', operator: 'lt | lte | eq | gte | gt | ne | contains', value: 'Value to compare against.' }
  },
  addToList: {
    summary: 'Appends each `values` row (one element apiece) to the `list` target, emitting the new list on `result`. Pure by default — persist it back with a downstream setVariable, or set `updateSourceVariable` to write it straight into the source variable.',
    config: { list: 'Target list: a list-typed variable reference `{ type:"variable", value:"<name>" }`, or wire a list into the `list` port. (No inline list literal — you can\'t author a list here.)', values: 'Rows of values to append: `{ id, value }[]` (like object properties); each row gets a `<id>` input port to wire.', updateSourceVariable: 'When true AND `list` is an un-wired variable, also writes the new list back into that variable (push). Default false (pure).' }
  },
  removeFromList: {
    summary: 'Removes from `list` every element deep-equal to any `values` row, emitting the new list on `result`. Pure by default; `updateSourceVariable` writes it back to the source variable.',
    config: { list: 'Target list: a list-typed variable reference `{ type:"variable", value:"<name>" }`, or wire a list into the `list` port. (No inline list literal.)', values: 'Rows of values to remove: `{ id, value }[]` (like object properties); each row gets a `<id>` input port to wire.', updateSourceVariable: 'When true AND `list` is an un-wired variable, also writes the new list back into that variable. Default false (pure).' }
  },
  wait: {
    summary: 'Sleeps for a duration, then passes the trigger through. Aborts cleanly on Stop.',
    config: { duration: 'Duration value.', inputUnit: 'ms | s | min | h — unit for a wired `duration` (default s).', durationMs: 'Alternative fixed duration in ms.' }
  },
  waitUntil: {
    summary: 'Sleeps until a target time (ISO string or epoch ms); a past time fires immediately.',
    config: { until: 'Target time (or wire the `until` port).' }
  },
  now: {
    summary: 'Emits the current time.',
    config: { format: 'datetime (ISO, default) | epoch | string.' }
  },
  arithmetic: {
    summary: 'Computes `a op b` → number on `result`.',
    config: { op: 'add | sub | mul | div | mod | pow' }
  },
  comparator: {
    summary: 'Compares `a` and `b` with `operator` → boolean on `result`.',
    config: { operator: 'lt | lte | eq | gte | gt | ne | contains' }
  },
  boolean: {
    summary: 'Boolean logic `a op b` → boolean on `result`.',
    config: { op: 'and | or | xor | not' }
  },
  object: {
    summary: 'Assembles an object from its named property inputs (port id = property name) on `object`.',
    config: {}
  },
  setVariable: {
    summary: 'Stores the `value` input into the run\'s variable store under `name`; emits a signal on `event`.',
    config: { name: 'Variable name.' }
  },
  getVariable: {
    summary: 'Reads the run variable `name` onto `value`.',
    config: { name: 'Variable name.' }
  },
  transform: {
    summary: 'Applies a Handlebars `expression` to its inputs + run variables, emitting the rendered result on `out`.',
    config: { expression: 'Handlebars template.' }
  },
  cast: {
    summary: 'Converts the `value` input (wired or inline) to `targetType` on `result`; an impossible cast (or a null value) routes to `error`. number↔boolean (0/1, truthiness), numeric/boolean string parsing, dates ISO; any → list wraps into [value].',
    config: { targetType: 'number | string | boolean | date | list', value: 'Inline value to cast (typed value) when not wired.' }
  },
  regex: {
    summary: 'Runs `op` over the `value` string on `result`; an invalid pattern routes to `error`, a non-match is not an error. extract → first match (named-groups object | first group | whole match, else null); extractAll → list; test → boolean; replace → string (supports $1 / $<name>); split → list.',
    config: { op: 'extract | extractAll | test | replace | split', pattern: 'Regular-expression source.', flags: 'Flags i/m/s (g is implicit for extractAll/replace).', replacement: 'Replacement string (replace op).', value: 'Inline string when not wired.' }
  },
  json: {
    summary: 'parse → the `value` JSON string into a value (malformed JSON → `error`; an already-structured value passes through); stringify → any `value` to a JSON string on `result` (`indent>0` pretty-prints; a circular / non-serialisable value → `error`).',
    config: { op: 'parse | stringify', indent: 'Pretty-print spaces for stringify (0 = compact, max 10).', value: 'Inline value when not wired (a JSON string for parse).' }
  },
  xml: {
    summary: 'parse → the `value` XML string into an object (attributes under `@_`; malformed XML → `error`; an already-structured value passes through); stringify → an object `value` to an XML string on `result` (`indent>0` pretty-prints).',
    config: { op: 'parse | stringify', indent: 'Pretty-print spaces for stringify (0 = single-line, max 10).', value: 'Inline value when not wired (an XML string for parse).' }
  },
  yaml: {
    summary: 'parse → the `value` YAML string into a value (malformed YAML → `error`; an already-structured value passes through); stringify → any `value` to a YAML string on `result` (indented by `indent` spaces, 1–10).',
    config: { op: 'parse | stringify', indent: 'Indent spaces for stringify (1–10, default 2).', value: 'Inline value when not wired (a YAML string for parse).' }
  },
  crypto: {
    summary: 'Transforms the `value` string on `result`: base64Encode/base64Decode, md5/sha1/sha256/sha512 (hex digest), hmacSha256 (keyed, hex), uuid (a fresh v4, ignores value). A missing HMAC key or a non-UTF-8 base64Decode → `error`.',
    config: { op: 'base64Encode | base64Decode | md5 | sha1 | sha256 | sha512 | hmacSha256 | uuid', key: 'Secret key (hmacSha256 only).', value: 'Inline string when not wired.' }
  },
  jwt: {
    summary: 'Decodes the `value` JWT/JWS token string into `{ header, payload, signature }` on `result` (signature is the raw segment, NOT verified). A non-string or malformed token → `error`.',
    config: { value: 'Inline token string when not wired.' }
  },
  datetime: {
    summary: 'Transforms an existing date wired/inline on `value` (the clock itself is the `now` node). add/subtract → shift by `amount` of `unit` → ISO string; format → a luxon pattern string; diff → `other − value` in `unit` → number. An unreadable date → `error`.',
    config: { op: 'add | subtract | format | diff', amount: 'Amount for add/subtract.', unit: 'milliseconds | seconds | minutes | hours | days | weeks | months | years.', format: 'luxon format pattern (format op; empty = ISO).', other: 'Second date for diff (typed value).', value: 'Inline date when not wired.' }
  },
  retry: {
    summary: 'Re-runs the body wired off `attempt` as an ERROR-BOUNDARY scope: an unhandled error in the body (or, for an httpRequest child, a response matching `retryOnStatus` / a non-2xx when `retryOnFailure`) marks the attempt failed and re-runs it per the backoff policy, up to `maxAttempts`. Success exits via the implicit `done` port; giving up exits via `exhausted`. Wire `attempt` → the action(s) to retry.',
    config: { maxAttempts: 'Max attempts (default 3).', backoff: 'fixed | linear | exponential.', delay: 'Base delay.', delayUnit: 'ms | s | min.', factor: 'Exponential factor (default 2).', maxDelay: 'Optional delay cap.', maxDelayUnit: 'ms | s | min.', retryOnError: 'Retry on a bubbled error (default true).', retryOnFailure: 'Retry on a non-2xx httpRequest response (default false).', retryOnStatus: 'HTTP status codes to retry on (e.g. [429, 503]).' }
  },
  objectOp: {
    summary: 'Reshapes the `value` object on `result` (distinct from the `object` BUILDER): get/set a dot-`path`, merge with `other`, pick/omit `keys`, or list keys/values. A non-object operand (where the op needs one) → `error`.',
    config: { op: 'get | set | merge | pick | omit | keys | values', path: 'Dot-path for get/set.', keys: 'Comma-separated keys for pick/omit.', other: 'Value to set / object to merge (typed value).', value: 'Inline object when not wired.' }
  },
  url: {
    summary: 'encode/decode a URI component, parseQuery (string → object) / buildQuery (object → string), or parseUrl (→ { protocol, hostname, port, pathname, search, hash, origin, query }). A malformed escape / non-object buildQuery / bad URL → `error`.',
    config: { op: 'encode | decode | parseQuery | buildQuery | parseUrl', value: 'Inline value when not wired.' }
  },
  random: {
    summary: 'Generates a value on `result`: int/float in [min,max], string of `length`, boolean, or pick from a list. A `seed` (number or string) makes it deterministic. `pick` over an empty list → `error`. No data input.',
    config: { op: 'int | float | string | boolean | pick', min: 'Range min (int/float).', max: 'Range max (int/float).', length: 'String length.', seed: 'Optional seed for reproducible output.', items: 'List to pick from (pick op).' }
  },
  throw: {
    summary: 'Deliberately fails with `message` (wired or inline) — routed to the implicit `error` port, or fails the run if nothing handles it. For error branches + retry tests. No `done`/value output.',
    config: { message: 'Failure message (typed value; or wire `message`).' }
  },
  log: {
    summary: 'Writes one entry to the run log (visible via get_scenario_run_status + the inspector panel) and passes the value through. Sequence it via the `in` trigger.',
    config: { level: 'debug | info | warn | error', message: 'Text (typed value).', data: 'Optional structured payload (or wire `data`).' }
  },
  assert: {
    summary: 'Compares `actual`/`expected` with `operator`, routing the trigger to `then` (pass) or `else` (fail).',
    config: { operator: 'lt | lte | eq | gte | gt | ne | contains', message: 'Failure label.' }
  }
}
