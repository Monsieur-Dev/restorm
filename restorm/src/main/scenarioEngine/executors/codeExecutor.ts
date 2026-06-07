import type { NodeExecutor } from '../types'

/**
 * `code` node: runs the user's TypeScript/JavaScript in the QuickJS sandbox.
 *
 * The wired `value` input is exposed inside the script as `input`; the run's
 * variables as `vars`; a curated standard library (lodash, moment, uuid, …) as
 * globals + `require()`. Whatever the script `return`s flows out of `result`.
 * `console.log(...)` lines are surfaced as user run-log entries. A script error
 * or a timeout throws — the scheduler then routes to the node's `error` port.
 *
 * The sandbox module (esbuild + QuickJS-WASM) is imported lazily so those heavy
 * dependencies only load the first time a code node actually executes.
 */
export const codeExecutor: NodeExecutor = async (act, ctx) => {
  const cfg = ctx.node.config as { code?: unknown; timeout?: unknown }
  const code = typeof cfg.code === 'string' ? cfg.code : ''
  const input = act.inputs['value']

  // No script → pass the input straight through (a harmless no-op box).
  if (code.trim() === '') return { outputs: [{ port: 'result', value: input ?? null }] }

  const timeoutSec = typeof cfg.timeout === 'number' && cfg.timeout > 0 ? cfg.timeout : 5
  const variables = Object.fromEntries(ctx.variables.entries())

  const { runCodeInSandbox } = await import('../codeSandbox')
  const { result, logs } = await runCodeInSandbox({
    code,
    input,
    variables,
    timeoutMs: Math.min(timeoutSec * 1000, 60_000)
  })
  for (const line of logs) {
    ctx.log({ level: 'info', message: line, nodeId: act.nodeId, scope: act.scope, source: 'user' })
  }
  return { outputs: [{ port: 'result', value: result }] }
}
