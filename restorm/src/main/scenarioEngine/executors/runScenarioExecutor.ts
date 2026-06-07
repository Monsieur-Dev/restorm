/**
 * Sub-scenario executor: hands off to the engine's `runSubScenario`
 * callback (injected via `SchedulerInit`). The activation's inputs
 * map carries the sub-scenario's named params; the result is the
 * sub-scenario's `output` node values.
 *
 * Recursion detection lives in the engine container — when it spots
 * a scenario id already on the call stack, it throws before this
 * executor even fires, so the per-node UX gets a clean error edge.
 */

import type { NodeExecutor } from '../types'
import { resolveOperand } from '../conditionEval'

export const runScenarioExecutor: NodeExecutor = async (act, ctx) => {
  const cfg = ctx.node.config as { scenarioId?: string }
  if (typeof cfg.scenarioId !== 'string') throw new Error(`runScenario node ${ctx.node.id} has no bound scenarioId`)
  // Derived input ports are named `param:<name>` (see
  // `deriveRunScenarioPorts`). Strip that prefix so the sub-scenario's
  // `input` node — keyed by the bare param name — actually receives the
  // wired value (e.g. a `forEach` `each` → `param:name` feeds the
  // sub-scenario's `name`). Bare keys (legacy) pass through unchanged.
  const params: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(act.inputs)) {
    if (v === undefined) continue
    const key = k.startsWith('param:') ? k.slice('param:'.length) : k
    params[key] = v
  }
  // Inline values entered on the call site (`config.paramValues[<name>]`) fill
  // any param NOT wired by a link — resolved like any operand, so an
  // `environment` value becomes `{ name, variables }`, a colour its hex, etc.
  const inlineValues: unknown = ctx.node.config['paramValues']
  if (inlineValues !== null && typeof inlineValues === 'object') {
    for (const [name, valueType] of Object.entries(inlineValues as Record<string, unknown>)) {
      if (name in params) continue // a wired link wins over the inline value
      const resolved = resolveOperand(undefined, valueType, undefined)
      if (resolved !== undefined) params[name] = resolved
    }
  }
  // Pass our own abort signal so cancelling THIS run cascades into the
  // sub-scenario (its in-flight HTTP / wait timers abort too) — without
  // it, a Stop on the parent leaves the sub-run executing.
  const outputs = await ctx.runSubScenario(cfg.scenarioId, params, ctx.signal)
  // The runScenario node derives one output port per sub-scenario
  // `output` node, with id `output:<name>` (see `deriveRunScenarioPorts`).
  // Emit on those derived ids; also emit the whole map on the default
  // `result` port so a node wired to `result` still receives the bundle.
  // Do NOT emit `done` here: completion is signalled by the UNIVERSAL `done`
  // port (the scheduler fires it as a pure `true` continuation once the box
  // returns — see `Scheduler.fireDonePort`). Emitting our own `done` token too
  // would double-fire every downstream node, so a chain of runScenarios would
  // re-trigger and cascade non-deterministically.
  const emissions = [
    { port: 'result', value: outputs },
    ...Object.entries(outputs).map(([name, value]) => ({ port: `output:${name}`, value }))
  ]
  return { outputs: emissions }
}
