import type { NodeExecutor } from '../types'
import type { SandboxScriptContext } from '../codeSandbox'

/** Build a Postman/Bruno script context from a `scriptMode` node's input. A
 * post-response node is wired from the upstream httpRequest's `response` output
 * (`{ request, response }`); a pre-request node gets whatever flows in (often
 * nothing — it mostly sets variables). Best-effort + tolerant of either the
 * `{ request, response }` envelope or a bare request/response object. */
export function toScriptContext(input: unknown): SandboxScriptContext {
  const env = (input && typeof input === 'object') ? (input as Record<string, unknown>) : {}
  const reqSrc = (env['request'] && typeof env['request'] === 'object') ? (env['request'] as Record<string, unknown>) : env
  const respSrc = (env['response'] && typeof env['response'] === 'object') ? (env['response'] as Record<string, unknown>) : undefined
  const asHeaders = (h: unknown): Record<string, string> => (h && typeof h === 'object') ? (h as Record<string, string>) : {}
  const out: SandboxScriptContext = {
    request: {
      url: typeof reqSrc['url'] === 'string' ? reqSrc['url'] : '',
      method: typeof reqSrc['method'] === 'string' ? reqSrc['method'] : 'GET',
      headers: asHeaders(reqSrc['headers'])
    }
  }
  if (respSrc) {
    const bodyVal = respSrc['body']
    out.response = {
      code: typeof respSrc['status'] === 'number' ? respSrc['status'] : (typeof respSrc['code'] === 'number' ? respSrc['code'] : 0),
      statusText: typeof respSrc['statusText'] === 'string' ? respSrc['statusText'] : '',
      headers: asHeaders(respSrc['headers']),
      body: typeof bodyVal === 'string' ? bodyVal : (bodyVal != null ? JSON.stringify(bodyVal) : ''),
      responseTime: typeof respSrc['durationMs'] === 'number' ? respSrc['durationMs'] : (typeof respSrc['responseTime'] === 'number' ? respSrc['responseTime'] : 0)
    }
  }
  return out
}

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
 * When `config.scriptMode` is set (`postman-prerequest` / `postman-postresponse`
 * / `bruno-*`, written by the Postman/Bruno workflow importer), the source runs as a
 * VERBATIM Postman/Bruno script: the pm/bru runtime is built from the node's
 * input, and the script's outcome (mutated request, test results,
 * `setNextRequest`) flows out of `result`.
 *
 * The runtimes load their heavy WASM engines lazily, only the first time a code
 * node of that language actually executes.
 */
export const codeExecutor: NodeExecutor = async (act, ctx) => {
  const cfg = ctx.node.config as { code?: unknown; timeout?: unknown; language?: unknown; scriptMode?: unknown }
  const code = typeof cfg.code === 'string' ? cfg.code : ''
  const input = act.inputs['value']
  // Postman/Bruno verbatim-script mode (set by the workflow importer).
  const scriptMode = typeof cfg.scriptMode === 'string' ? cfg.scriptMode : undefined
  const scriptCtx = scriptMode ? toScriptContext(input) : undefined

  // No script → pass the input straight through (a harmless no-op box).
  if (code.trim() === '') return { outputs: [{ port: 'result', value: input ?? null }] }

  // Which language runtime to use — absent → TypeScript/JavaScript (the original
  // default), so existing nodes keep their behaviour without a persisted key.
  // Postman/Bruno scripts are always JavaScript.
  const language = scriptMode ? 'javascript' : (typeof cfg.language === 'string' ? cfg.language : 'typescript')
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
  const { result, logs, postman } = await runtime.run(code, {
    input,
    variables,
    timeoutMs: Math.min(timeoutSec * 1000, 60_000),
    // `fetch` / `pm.sendRequest` route through the firewall (codeNetworkBridge)
    // for runtimes that support it (JS); others ignore it.
    network: codeNetworkBridge,
    // Read/write scenario variables from the script (JS runtime only).
    variableBridge,
    // Verbatim Postman/Bruno script context (JS runtime only).
    ...(scriptCtx && scriptMode?.startsWith('bru') ? { bruno: scriptCtx } : {}),
    ...(scriptCtx && !scriptMode?.startsWith('bru') ? { postman: scriptCtx } : {}),
    // User Stop / scope abort cancels an in-flight run / network request at once.
    signal: ctx.signal
  })
  for (const line of logs) {
    ctx.log({ level: 'info', message: line, nodeId: act.nodeId, scope: act.scope, source: 'user' })
  }
  // A pm/bru script emits its outcome (mutated request, test results,
  // setNextRequest) on `result`, with the script's return value under `value`;
  // a plain code node emits its return value directly.
  const outValue: unknown = scriptMode ? { ...(postman ?? {}), value: result } : result
  // Record the freshest run so the inspector preview can show this box's last
  // result/logs (code boxes have no on-disk history to read back from).
  const { recordCodeRun } = await import('../codeRunCache')
  recordCodeRun(act.nodeId, { result: outValue, logs, timestamp: new Date().toISOString() })
  return { outputs: [{ port: 'result', value: outValue }] }
}
