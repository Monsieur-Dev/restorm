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
  aggregateExecutor
} from './timeAndFlowExecutors'
import { httpRequestExecutor } from './httpRequestExecutor'
import { runScenarioExecutor } from './runScenarioExecutor'

/** Pure passthrough — an `input` node just forwards its (resolved
 * default OR provided param) value to the `value` port. The seed
 * activation set up by the scheduler already places the value in
 * `inputs.value`. */
const inputPassthroughExecutor: NodeExecutor = (act) => ({ outputs: [{ port: 'value', value: act.inputs['value'] }] })

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
    case 'aggregate': return aggregateExecutor
    case 'httpRequest':
    case 'request': return httpRequestExecutor
    case 'runScenario': return runScenarioExecutor
    case 'input': return inputPassthroughExecutor
    case 'output': return outputPassthroughExecutor
    default: throw new Error(`no executor for kind '${kind}'`)
  }
}
