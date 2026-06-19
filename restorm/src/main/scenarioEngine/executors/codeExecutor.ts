import type { NodeExecutor } from '../types'
import type { SandboxScriptContext, SandboxHttpResponse } from '../codeSandbox'
// Import the sentinel from the light module — NOT codeSandbox — so the executor
// (and the scheduler that registers it) doesn't eagerly load esbuild/QuickJS.
import { SKIP_REQUEST_SENTINEL } from '../scriptSentinels'
import { collectionStore } from '../../services/CollectionStore'
import { isHTTPRequest } from '../../../shared/types/collections'
import { resolveRequestByName } from './resolveRequestByName'

/** Hard cap on a code node's run time, regardless of the configured timeout. */
const CODE_MAX_TIMEOUT_MS = 60_000

/** Resolve a Bruno `bru.runRequest(target)` reference (id / name / `folder/req`
 * path) to a concrete request in the open project. Matches the most specific
 * name-form first rather than blindly splitting on `/` — so a request whose
 * name literally contains a slash still resolves. See `resolveRequestByName`. */
function findRequestByName(name: string): { id: string; method: string } | undefined {
  return resolveRequestByName(collectionStore.getCollections() as unknown[], name)
}

interface KV { key: string; value?: unknown; enabled?: boolean }

/** Snapshot a bound request's url/method/headers/body so a pre-request script
 * sees the real outgoing request in `pm.request` / `req` (and read-modify-write
 * of the URL or body works, not just header additions). Templates stay raw —
 * `{{vars}}` are resolved later, at send time, like Postman. */
function boundRequestSnapshot(requestId: string): SandboxScriptContext['request'] | undefined {
  const req = collectionStore.findById(requestId)
  if (!req || !isHTTPRequest(req)) return undefined
  const r = req as unknown as { url?: string; method?: string; headers?: KV[]; body?: { content?: unknown; raw?: unknown } | string }
  const headers: Record<string, string> = {}
  for (const h of r.headers ?? []) {
    if (h.enabled === false || typeof h.key !== 'string' || h.key === '') continue
    const v = h.value
    headers[h.key] = typeof v === 'string' ? v : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v as number | boolean)
  }
  let body: string | undefined
  const b = r.body
  if (typeof b === 'string') body = b
  else if (b && typeof b === 'object') {
    const raw = b.content ?? b.raw
    body = typeof raw === 'string' ? raw : undefined
  }
  return { url: r.url ?? '', method: r.method ?? 'GET', headers, ...(body !== undefined ? { body } : {}) }
}

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
  const cfg = ctx.node.config as { code?: unknown; timeout?: unknown; language?: unknown; scriptMode?: unknown; requestId?: unknown }
  // A wired `code` input (the script text supplied by an upstream node) wins over
  // the inline editor's code.
  const wiredCode = act.inputs['code']
  const code = typeof wiredCode === 'string' ? wiredCode : (typeof cfg.code === 'string' ? cfg.code : '')
  const input = act.inputs['value']
  // Postman/Bruno verbatim-script mode (set by the workflow importer).
  const scriptMode = typeof cfg.scriptMode === 'string' ? cfg.scriptMode : undefined
  let scriptCtx: SandboxScriptContext | undefined
  if (scriptMode) {
    scriptCtx = toScriptContext(input)
    // Data-driven runs: a wired input row (a plain object) populates
    // `pm.iterationData`, so a collection that reads `pm.iterationData.get(...)`
    // sees the current row.
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      scriptCtx = { ...scriptCtx, iterationData: input as Record<string, unknown> }
    }
    // Pre-request scripts mutate `pm.request` / `req` — seed it from the bound
    // request so read-modify-write of url/body works (not just header adds). The
    // mutated request flows out on `result` → the httpRequest's `requestOverride`.
    if (scriptMode.endsWith('prerequest') && typeof cfg.requestId === 'string') {
      const bound = boundRequestSnapshot(cfg.requestId)
      if (bound) scriptCtx = { ...scriptCtx, request: bound }
    }
  }

  // No script → pass the input straight through (a harmless no-op box).
  if (code.trim() === '') return { outputs: [{ port: 'result', value: input ?? null }] }

  // Which language runtime to use — absent → TypeScript/JavaScript (the original
  // default), so existing nodes keep their behaviour without a persisted key.
  // Postman/Bruno scripts are always JavaScript.
  const language = scriptMode ? 'javascript' : (typeof cfg.language === 'string' ? cfg.language : 'typescript')
  const timeoutSec = typeof cfg.timeout === 'number' && cfg.timeout > 0 ? cfg.timeout : 5
  const timeoutMs = Math.min(timeoutSec * 1000, CODE_MAX_TIMEOUT_MS)
  if (timeoutSec * 1000 > CODE_MAX_TIMEOUT_MS) {
    // Surface the clamp: a configured timeout above the cap silently ran for
    // less than requested before.
    ctx.log({
      level: 'warn',
      source: 'engine',
      nodeId: act.nodeId,
      scope: act.scope,
      message: `code timeout ${timeoutSec}s exceeds the ${CODE_MAX_TIMEOUT_MS / 1000}s cap; clamped to ${CODE_MAX_TIMEOUT_MS / 1000}s`
    })
  }
  // `__`-prefixed keys are the engine's reserved namespace (e.g. `__rng:<node>`
  // for seeded-random sequence state) — keep them out of the user's variable view.
  const variables = Object.fromEntries(
    [...ctx.variables.entries()].filter(([k]) => !k.startsWith('__'))
  )

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
  // Bruno `bru.runRequest(name)`: resolve the named request + run it through the
  // real HTTP pipeline (auth/env/firewall), returning its response to the script.
  const runRequestBridge = async (name: string, signal: AbortSignal): Promise<SandboxHttpResponse> => {
    const target = findRequestByName(name)
    if (!target) return { status: 0, statusText: '', headers: {}, body: '', error: `bru.runRequest: no request named "${name}"` }
    const [{ flushRequestStateToContext }, { httpExecutionService }] = await Promise.all([
      import('../../mcp/tools/execute'),
      import('../../services/HTTPExecutionService')
    ])
    const full = collectionStore.findById(target.id)
    if (full) flushRequestStateToContext(full)
    // Honour the run's cancellation: a Stop / timeout aborts the in-flight call
    // instead of leaving it running in the background after the script gave up.
    const onAbort = (): void => { httpExecutionService.cancel(target.id) }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
    try {
      const r = await httpExecutionService.execute({ requestId: target.id, method: target.method })
      const base = { status: r.statusCode ?? 0, statusText: r.statusText ?? '', headers: r.headers ?? {}, body: r.body ?? '' }
      // A transport/protocol failure must surface as an error so the bru shim
      // rejects, rather than resolving to a misleading empty 0/'' "success".
      if (!r.success || r.error !== undefined) {
        return { ...base, error: r.error ?? `bru.runRequest: request "${name}" failed` }
      }
      return base
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  const { result, logs, postman } = await runtime.run(code, {
    input,
    variables,
    timeoutMs,
    // `fetch` / `pm.sendRequest` route through the firewall (codeNetworkBridge)
    // for runtimes that support it (JS); others ignore it.
    network: codeNetworkBridge,
    // Read/write scenario variables from the script (JS runtime only).
    variableBridge,
    // Verbatim Postman/Bruno script context (JS runtime only).
    ...(scriptCtx && scriptMode?.startsWith('bru') ? { bruno: scriptCtx, runRequest: runRequestBridge } : {}),
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
  let outValue: unknown = result
  if (scriptMode) {
    const pm = { ...(postman ?? {}) }
    // `pm.execution.skipRequest()` → flag the request the httpRequest pulls in
    // via `requestOverride`, so it short-circuits its network call.
    if (pm.nextRequest === SKIP_REQUEST_SENTINEL) {
      pm.request = { ...(pm.request ?? {}), __skipRequest: true } as SandboxScriptContext['request']
    }
    outValue = { ...pm, value: result }
  }
  // Record the freshest run so the inspector preview can show this box's last
  // result/logs (code boxes have no on-disk history to read back from).
  const { recordCodeRun } = await import('../codeRunCache')
  recordCodeRun(act.nodeId, { result: outValue, logs, timestamp: new Date().toISOString() })
  return { outputs: [{ port: 'result', value: outValue }] }
}
