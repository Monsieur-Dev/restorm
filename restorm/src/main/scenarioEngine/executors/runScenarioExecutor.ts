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

export const runScenarioExecutor: NodeExecutor = async (act, ctx) => {
  const cfg = ctx.node.config as { scenarioId?: string }
  if (typeof cfg.scenarioId !== 'string') throw new Error(`runScenario node ${ctx.node.id} has no bound scenarioId`)
  const params: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(act.inputs)) {
    if (v === undefined) continue
    params[k] = v
  }
  const outputs = await ctx.runSubScenario(cfg.scenarioId, params)
  // Emit each output port from the sub-scenario as its own emission.
  // The renderer derives the run-scenario node's outputs from the
  // sub-scenario's output nodes, so the names should line up.
  const emissions = Object.entries(outputs).map(([port, value]) => ({ port, value }))
  return { outputs: emissions }
}
