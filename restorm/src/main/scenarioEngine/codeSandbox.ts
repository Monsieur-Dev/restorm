/**
 * Sandboxed TypeScript/JavaScript execution for the `code` scenario node.
 *
 * Two stages, mirroring how Postman / Bruno run user scripts:
 *  1. **Transpile** — strip TypeScript types with esbuild (`loader: 'ts'`); no
 *     type-check, just a fast syntactic transform.
 *  2. **Execute** — run the JS inside a QuickJS interpreter compiled to
 *     WebAssembly (`quickjs-emscripten`). QuickJS is a *separate* engine with no
 *     access to Node, the filesystem, the network or the host globals — the only
 *     things reachable are what we explicitly inject (a curated standard library,
 *     the node's `input`, and the run's variables). A runaway loop is bounded by
 *     a wall-clock deadline via QuickJS's interrupt handler, so it can never
 *     freeze the engine.
 *
 * The curated standard library is bundled ONCE (esbuild, cached) into a single
 * IIFE that defines the libs as globals + a `require()` shim, then evaluated in
 * the QuickJS context before the user code. Mirrors the Postman/Bruno built-ins.
 */

import { build as esbuild, transform as esbuildTransform } from 'esbuild'
import { getQuickJS, shouldInterruptAfterDeadline, type QuickJSContext, type QuickJSHandle } from 'quickjs-emscripten'

/** The curated, pure-JS standard library exposed inside the sandbox (a superset
 * of what Postman and Bruno bundle). Each entry is `globalThis.<global> = <pkg>`
 * + reachable through the `require()` shim. Libraries that need Node built-ins
 * (cheerio, xml2js, …) are added once their browser-safe bundling is verified. */
const SANDBOX_LIBS: { global: string; module: string; requireNames: string[] }[] = [
  { global: '_', module: 'lodash', requireNames: ['lodash'] },
  { global: 'lodash', module: 'lodash', requireNames: [] },
  { global: 'moment', module: 'moment', requireNames: ['moment'] },
  { global: 'uuid', module: 'uuid', requireNames: ['uuid'] },
  { global: 'nanoid', module: 'nanoid', requireNames: ['nanoid'] },
  { global: 'CryptoJS', module: 'crypto-js', requireNames: ['crypto-js', 'CryptoJS'] },
  { global: 'Ajv', module: 'ajv', requireNames: ['ajv'] }
]

/** Build (once) the standard-library prelude: an IIFE that assigns each lib to a
 * global and installs a `require()` shim. esbuild resolves the packages from
 * node_modules and bundles them browser-style (no Node built-ins). */
let preludePromise: Promise<string> | null = null
function getStdlibPrelude(): Promise<string> {
  if (preludePromise) return preludePromise
  const requireMap: Record<string, string> = {}
  const imports: string[] = []
  for (const [i, lib] of SANDBOX_LIBS.entries()) {
    const local = `__lib${i}`
    imports.push(`import * as ${local}_ns from '${lib.module}'`)
    // Interop: prefer a CJS default export, fall back to the namespace.
    imports.push(`const ${local} = ${local}_ns && ${local}_ns.default ? ${local}_ns.default : ${local}_ns`)
    imports.push(`globalThis.${lib.global} = ${local}`)
    for (const name of lib.requireNames) requireMap[name] = local
  }
  const requireShim =
    `const __req = {${Object.entries(requireMap).map(([k, v]) => `${JSON.stringify(k)}: ${v}`).join(', ')}};` +
    `globalThis.require = (n) => { if (n in __req) return __req[n]; throw new Error('module \\'' + n + '\\' is not available in the sandbox'); };`
  const entry = `${imports.join('\n')}\n${requireShim}`
  preludePromise = esbuild({
    stdin: { contents: entry, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    write: false,
    legalComments: 'none',
    // uuid / nanoid are namespace-only (no default) — the `.default ?? ns`
    // interop below is intentional, so silence the always-undefined warnings.
    logLevel: 'silent'
  }).then((res) => res.outputFiles[0].text)
  return preludePromise
}

/** Minimal polyfills for the browser/host globals a few bundled libs reference
 * at load time but QuickJS (pure ES2020) doesn't provide. Evaluated BEFORE the
 * library bundle so the libs find them. Kept deliberately small — not a full
 * platform, just enough for the curated stdlib to initialise. */
const SANDBOX_SHIMS = `
(function(){
  var g = globalThis;
  if (typeof g.EventTarget === 'undefined') {
    g.EventTarget = function EventTarget(){};
    g.EventTarget.prototype.addEventListener = function(){};
    g.EventTarget.prototype.removeEventListener = function(){};
    g.EventTarget.prototype.dispatchEvent = function(){ return true; };
  }
  if (typeof g.crypto === 'undefined') g.crypto = {};
  if (!g.crypto.getRandomValues) {
    g.crypto.getRandomValues = function(arr){ for (var i=0;i<arr.length;i++) arr[i] = Math.floor(Math.random()*256); return arr; };
  }
  if (typeof g.TextEncoder === 'undefined') {
    g.TextEncoder = function(){};
    g.TextEncoder.prototype.encode = function(str){
      str = String(str); var out = [];
      for (var i=0;i<str.length;i++){ var c = str.charCodeAt(i);
        if (c < 0x80) out.push(c);
        else if (c < 0x800) out.push(0xc0|(c>>6), 0x80|(c&0x3f));
        else out.push(0xe0|(c>>12), 0x80|((c>>6)&0x3f), 0x80|(c&0x3f)); }
      return new Uint8Array(out);
    };
  }
  if (typeof g.TextDecoder === 'undefined') {
    g.TextDecoder = function(){};
    g.TextDecoder.prototype.decode = function(buf){
      var a = buf instanceof Uint8Array ? buf : new Uint8Array(buf || []);
      var s = '', i = 0;
      while (i < a.length){ var c = a[i++];
        if (c < 0x80) s += String.fromCharCode(c);
        else if (c < 0xe0) s += String.fromCharCode(((c&0x1f)<<6)|(a[i++]&0x3f));
        else s += String.fromCharCode(((c&0x0f)<<12)|((a[i++]&0x3f)<<6)|(a[i++]&0x3f)); }
      return s;
    };
  }
  if (typeof g.queueMicrotask === 'undefined') g.queueMicrotask = function(cb){ Promise.resolve().then(cb); };
  // setTimeout fires on the next microtask (the delay is ignored — the sandbox
  // has no real event loop, and a deterministic, immediate resolution is what an
  // \`await new Promise(r => setTimeout(r, …))\` actually needs here). setInterval
  // is a no-op so it can never spin forever.
  if (typeof g.setTimeout === 'undefined') {
    g.setTimeout = function(fn){ if (typeof fn === 'function') Promise.resolve().then(function(){ try { fn(); } catch (e) {} }); return 0; };
    g.clearTimeout = function(){};
  }
  if (typeof g.setInterval === 'undefined') { g.setInterval = function(){ return 0; }; g.clearInterval = function(){}; }
})();
`

export interface RunCodeOptions {
  /** The user's TypeScript/JavaScript source (treated as a function body that
   * may `return` the result). */
  code: string
  /** The node's wired/inline input value, exposed as the `input` global. */
  input?: unknown
  /** Run variables, exposed as the `vars` global (a plain object). */
  variables?: Record<string, unknown>
  /** Wall-clock execution budget; a runaway script is interrupted after it. */
  timeoutMs?: number
}

export interface RunCodeResult {
  /** The value returned by the user code (JSON-cloneable). */
  result: unknown
  /** Anything the script wrote via `console.log(...)`. */
  logs: string[]
}

/** Transpile + run user code in the QuickJS sandbox. Rejects with a normal
 * Error (message from the sandboxed throw) on a script error or timeout. */
export async function runCodeInSandbox(opts: RunCodeOptions): Promise<RunCodeResult> {
  const { code, input, variables = {}, timeoutMs = 5000 } = opts
  // 1. Transpile TS -> JS (types stripped; isolatedModules-safe single file).
  // Wrap as an ASYNC function body BEFORE transpiling, so esbuild sees the
  // top-level `await` / `return` inside a function (valid) instead of at module
  // scope (an error). The result is `(async () => { … })()` — a QuickJS promise.
  const wrappedSource = `(async function(){\n${code}\n})()`
  const transpiled = (await esbuildTransform(wrappedSource, { loader: 'ts', target: 'es2020' })).code
  const prelude = await getStdlibPrelude()

  const QuickJS = await getQuickJS()
  const ctx: QuickJSContext = QuickJS.newContext()
  const logs: string[] = []
  try {
    ctx.runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + timeoutMs))

    // console.log bridge: collect into `logs`.
    const consoleHandle = ctx.newObject()
    const logFn = ctx.newFunction('log', (...args) => {
      logs.push(args.map((a): string => { const v: unknown = ctx.dump(a); return typeof v === 'string' ? v : safeJson(v) }).join(' '))
    })
    ctx.setProp(consoleHandle, 'log', logFn)
    ctx.setProp(consoleHandle, 'info', logFn)
    ctx.setProp(consoleHandle, 'warn', logFn)
    ctx.setProp(consoleHandle, 'error', logFn)
    ctx.setProp(ctx.global, 'console', consoleHandle)
    consoleHandle.dispose()
    logFn.dispose()

    // 2. Global shims, then the standard library prelude.
    const shim = ctx.evalCode(SANDBOX_SHIMS)
    if (shim.error) { const e: unknown = ctx.dump(shim.error); shim.error.dispose(); throw new Error(`sandbox shims failed: ${stringifyErr(e)}`) }
    shim.value.dispose()

    const pre = ctx.evalCode(prelude)
    if (pre.error) { const e: unknown = ctx.dump(pre.error); pre.error.dispose(); throw new Error(`sandbox prelude failed: ${stringifyErr(e)}`) }
    pre.value.dispose()

    // 3. Inject input + variables as JSON (data only — no functions/dates).
    const injected = `globalThis.input = ${safeJson(input)}; globalThis.vars = ${safeJson(variables)};`
    const inj = ctx.evalCode(injected)
    if (inj.error) { const e: unknown = ctx.dump(inj.error); inj.error.dispose(); throw new Error(`sandbox input injection failed: ${stringifyErr(e)}`) }
    inj.value.dispose()

    // 4. Run the user code as an ASYNC function body so it may `await`. The
    //    result is a QuickJS promise; settle it (draining the job queue) and dump
    //    its value. A pure-JS await resolves via the pumped microtask queue; a
    //    never-settling await is bounded by the wall-clock timeout below.
    const out = ctx.evalCode(transpiled)
    if (out.error) { const e: unknown = ctx.dump(out.error); out.error.dispose(); throw new Error(stringifyErr(e)) }
    const settled = await settlePromise(ctx, out.value, timeoutMs)
    const result: unknown = ctx.dump(settled)
    settled.dispose()
    return { result, logs }
  } finally {
    // A timed-out async run can leave QuickJS promise handles undisposed, which
    // makes dispose() throw — that's fine, the whole context is being torn down.
    try { ctx.dispose() } catch { /* leaked handles on timeout */ }
  }
}

/** Settle a QuickJS promise: pump the job queue so pure-JS microtasks/promises
 * resolve, then await the result on the host — racing a wall-clock timeout so a
 * promise that never settles (e.g. `await new Promise(() => {})`) can't hang. */
async function settlePromise(ctx: QuickJSContext, promiseHandle: QuickJSHandle, timeoutMs: number): Promise<QuickJSHandle> {
  const resolved = ctx.resolvePromise(promiseHandle)
  promiseHandle.dispose()
  ctx.runtime.executePendingJobs()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new Error('code execution timed out')) }, timeoutMs) })
  try {
    const result = await Promise.race([resolved, timeout])
    ctx.runtime.executePendingJobs()
    if (result.error) { const e: unknown = ctx.dump(result.error); result.error.dispose(); throw new Error(stringifyErr(e)) }
    return result.value
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** JSON for injection; `undefined` becomes `undefined` (a valid JS literal). */
function safeJson(v: unknown): string {
  if (v === undefined) return 'undefined'
  try { const s = JSON.stringify(v); return typeof s === 'string' ? s : 'undefined' } catch { return 'undefined' }
}

/** Render a dumped QuickJS error (object with name/message or a primitive). */
function stringifyErr(e: unknown): string {
  if (typeof e === 'string') return e
  if (e && typeof e === 'object') {
    const o = e as { name?: string; message?: string; stack?: string }
    if (o.message) return o.name ? `${o.name}: ${o.message}` : o.message
    const s = safeJson(e)
    return s === 'undefined' ? 'error' : s
  }
  return safeJson(e) === 'undefined' ? String(e as number | boolean) : safeJson(e)
}
