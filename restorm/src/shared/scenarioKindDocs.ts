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
    summary: 'Keeps the items of a collection that satisfy a predicate, on `kept`.',
    config: { property: 'Item field to test.', operator: 'lt | lte | eq | gte | gt | ne | contains', value: 'Value to compare against.' }
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
  log: {
    summary: 'Writes one entry to the run log (visible via get_scenario_run_status + the inspector panel) and passes the value through. Sequence it via the `in` trigger.',
    config: { level: 'debug | info | warn | error', message: 'Text (typed value).', data: 'Optional structured payload (or wire `data`).' }
  },
  assert: {
    summary: 'Compares `actual`/`expected` with `operator`, routing the trigger to `then` (pass) or `else` (fail).',
    config: { operator: 'lt | lte | eq | gte | gt | ne | contains', message: 'Failure label.' }
  }
}
