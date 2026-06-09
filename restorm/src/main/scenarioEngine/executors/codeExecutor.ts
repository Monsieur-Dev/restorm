import type { NodeExecutor } from '../types'

/**
 * `code` node: runs the user's source in the per-language WASM runtime selected
 * by `config.language` (TypeScript/JavaScript → QuickJS, Python → Pyodide, …),
 * resolved through the runtime registry (`../codeRuntimes`).
 *
 * The wired `value` input is exposed inside the script as `input`; the run's
 * variables as `vars`; a curated standard library as globals (JS). Whatever the
 * script returns flows out of `result`; stdout / print / `console.log(...)` are
 * surfaced as user run-log entries. A script error or a timeout throws — the
 * scheduler then routes to the node's `error` port.
 *
 * The runtimes load their heavy WASM engines lazily, only the first time a code
 * node of that language actually executes.
 */
export const codeExecutor: NodeExecutor = async (act, ctx) => {
  const cfg = ctx.node.config as { code?: unknown; timeout?: unknown; language?: unknown }
  const code = typeof cfg.code === 'string' ? cfg.code : ''
  const input = act.inputs['value']

  // No script → pass the input straight through (a harmless no-op box).
  if (code.trim() === '') return { outputs: [{ port: 'result', value: input ?? null }] }

  // Which language runtime to use — absent → TypeScript/JavaScript (the original
  // default), so existing nodes keep their behaviour without a persisted key.
  const language = typeof cfg.language === 'string' ? cfg.language : 'typescript'
  const timeoutSec = typeof cfg.timeout === 'number' && cfg.timeout > 0 ? cfg.timeout : 5
  const variables = Object.fromEntries(ctx.variables.entries())

  const { ensureCodeRuntimes, getCodeRuntime } = await import('../codeRuntimes')
  ensureCodeRuntimes()
  const runtime = getCodeRuntime(language)
  if (runtime === undefined) throw new Error(`code node: no runtime for language '${language}'`)

  const { codeNetworkBridge } = await import('../codeNetworkBridge')
  // Read/WRITE view of the run's live variable map, so a script (or an imported
  // pm/bru script) that sets a variable persists it to the run for later nodes.
  const variableBridge = {
    get: (name: string): unknown => ctx.variables.get(name),
    set: (name: string, value: unknown): void => { ctx.variables.set(name, value) },
    has: (name: string): boolean => ctx.variables.has(name),
    delete: (name: string): void => { ctx.variables.delete(name) },
    names: (): string[] => Array.from(ctx.variables.keys())
  }
  const { result, logs } = await runtime.run(code, {
    input,
    variables,
    timeoutMs: Math.min(timeoutSec * 1000, 60_000),
    // `fetch` / `pm.sendRequest` route through the firewall (codeNetworkBridge)
    // for runtimes that support it (JS); others ignore it.
    network: codeNetworkBridge,
    // Read/write scenario variables from the script (JS runtime only).
    variableBridge,
    // User Stop / scope abort cancels an in-flight run / network request at once.
    signal: ctx.signal
  })
  for (const line of logs) {
    ctx.log({ level: 'info', message: line, nodeId: act.nodeId, scope: act.scope, source: 'user' })
  }
  // Record the freshest run so the inspector preview can show this box's last
  // result/logs (code boxes have no on-disk history to read back from).
  const { recordCodeRun } = await import('../codeRunCache')
  recordCodeRun(act.nodeId, { result, logs, timestamp: new Date().toISOString() })
  return { outputs: [{ port: 'result', value: result }] }
}
