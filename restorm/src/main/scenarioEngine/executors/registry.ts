/**
 * Per-kind executor registry. Returns a `Map<nodeId, NodeExecutor>`
 * the scheduler can index by node id directly — wrapping is per-kind
 * (no need to do a switch on every dispatch).
 */

import type { NodeExecutor } from '../types'
import type { ScenarioModel } from '../types'
import {
  arithmeticExecutor,
  comparatorExecutor,
  booleanExecutor,
  ifExecutor,
  whileExecutor,
  doWhileExecutor,
  switchExecutor,
  nowExecutor,
  setVariableExecutor,
  getVariableExecutor,
  objectExecutor,
  logExecutor,
  assertExecutor,
  mapExecutor,
  filterExecutor,
  transformExecutor
} from './pureExecutors'
import {
  waitExecutor,
  waitUntilExecutor,
  forEachExecutor,
  forExecutor,
  aggregateExecutor
} from './timeAndFlowExecutors'
import { httpRequestExecutor } from './httpRequestExecutor'
import { runScenarioExecutor } from './runScenarioExecutor'

/** An `input` node either: (a) seeded at run start with the user's
 * up-front value (the editor's pre-run modal) — pure passthrough; or
 * (b) activated mid-run because an upstream node fed a value into it
 * — in that case we surface a single-field prompt so the user can
 * confirm / edit before the value flows downstream. The `seeded`
 * flag on the activation distinguishes the two paths. */
const inputExecutor: NodeExecutor = async (act, ctx) => {
  // The seed activation already carries the `{ [name]: value }` shape
  // (see `Scheduler.seedRoots`); pass it through verbatim.
  if (act.seeded === true) return { outputs: [{ port: 'value', value: act.inputs['value'] }] }
  const cfg = ctx.node.config as { name?: string; valueType?: { type?: string } }
  const name = typeof cfg.name === 'string' && cfg.name !== '' ? cfg.name : 'value'
  const value = await ctx.requestUserInput({
    name: cfg.name ?? ctx.node.id,
    defaultValue: act.inputs['value'],
    hint: inferHint(cfg.valueType?.type)
  })
  // Wrap to match the static preview shape so a wired selector
  // (auto-deduced to the param name) resolves the same as the seeded path.
  return { outputs: [{ port: 'value', value: { [name]: value } }] }
}

function inferHint(t: string | undefined): 'string' | 'number' | 'boolean' | 'object' {
  switch (t) {
    case 'number': return 'number'
    case 'boolean': return 'boolean'
    case 'object': return 'object'
    case 'string':
    default: return 'string'
  }
}

/** `output` node: forwards its incoming value to the run's result
 * map. Wired by the engine container — here we just emit on the
 * `value` port (the scheduler bubbles it up). */
const outputPassthroughExecutor: NodeExecutor = (act) => ({ outputs: [{ port: 'value', value: act.inputs['value'] }] })

export function buildExecutorRegistry(scenario: ScenarioModel): Map<string, NodeExecutor> {
  const out = new Map<string, NodeExecutor>()
  for (const node of scenario.nodes) {
    out.set(node.id, pickExecutor(node.kind))
  }
  return out
}

function pickExecutor(kind: string): NodeExecutor {
  switch (kind) {
    case 'arithmetic': return arithmeticExecutor
    case 'comparator': return comparatorExecutor
    case 'boolean': return booleanExecutor
    case 'if': return ifExecutor
    case 'switch': return switchExecutor
    case 'now': return nowExecutor
    case 'setVariable': return setVariableExecutor
    case 'getVariable': return getVariableExecutor
    case 'object': return objectExecutor
    case 'log': return logExecutor
    case 'assert': return assertExecutor
    case 'map': return mapExecutor
    case 'filter': return filterExecutor
    case 'transform': return transformExecutor
    case 'wait': return waitExecutor
    case 'waitUntil': return waitUntilExecutor
    case 'forEach': return forEachExecutor
    case 'for': return forExecutor
    // `while` / `doWhile` are engine-managed scope loops: the executor marks
    // the loop, the scheduler runs the body + re-evaluates the condition each
    // iteration (no manual loop-back edge needed).
    case 'while': return whileExecutor
    case 'doWhile': return doWhileExecutor
    case 'aggregate': return aggregateExecutor
    case 'httpRequest':
    case 'request': return httpRequestExecutor
    case 'runScenario': return runScenarioExecutor
    case 'input': return inputExecutor
    case 'output': return outputPassthroughExecutor
    default: throw new Error(`no executor for kind '${kind}'`)
  }
}
