/**
 * R runtime — WebR (R compiled to WASM). WebR already runs R in its OWN
 * worker and exposes `interrupt()`, so — unlike the QuickJS / Pyodide / wasmoon
 * / ruby.wasm runtimes — R does NOT need the shared worker harness: it runs
 * against a lazily-initialised singleton WebR, and a runaway computation is
 * killed by racing a timeout that calls `webR.interrupt()`.
 *
 * Injection: the wired value is bound to the R global `input`, run variables to
 * `vars` (both converted JS→R via `objToR`). `cat(...)` / `print(...)` output is
 * captured and surfaced to the run-log; the value of the last expression is the
 * result (converted R→JS — scalars unwrap, named lists become objects).
 *
 * WebR's assets (R.wasm + the package VFS) are vendored in node_modules, so it
 * loads fully offline (no CDN) — `baseUrl` points at the local dist.
 */
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import type { CodeRuntime, CodeRunResult } from './types'

/** The slice of the WebR API this runtime drives (the package's own types aren't
 * imported to keep the dynamic-import boundary clean). */
interface RCaptureResult { output: { type: string; data: string }[]; result: { toJs: () => Promise<unknown> } }
interface RShelter { captureR: (code: string) => Promise<RCaptureResult>; purge: () => void }
interface WebRInstance { init: () => Promise<void>; interrupt: () => void; Shelter: new () => Promise<RShelter> }

// WebR is single-R-worker; serialise runs through one instance + a queue so
// concurrent code nodes don't interleave on the shared interpreter.
let webRSingleton: Promise<WebRInstance> | null = null
let queue: Promise<unknown> = Promise.resolve()

function getWebR(): Promise<WebRInstance> {
  webRSingleton ??= (async () => {
    const { WebR } = await import('webr') as unknown as { WebR: new (opts: { baseUrl: string }) => WebRInstance }
    const baseUrl = `${dirname(createRequire(import.meta.url).resolve('webr'))}/`
    const webR = new WebR({ baseUrl })
    await webR.init()
    return webR
  })()
  return webRSingleton
}

/** Serialise a JS value to an R literal (base R, no jsonlite): scalars map
 * directly, arrays/objects become `list(...)`. Used to bind `input` / `vars`
 * without WebR's fragile JS→R object coercion (which forces data.frames). */
function toRLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NA'
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'string') return JSON.stringify(v) // R double-quoted strings escape like JSON
  if (Array.isArray(v)) return `list(${v.map(toRLiteral).join(', ')})`
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>).map(([k, val]) => `\`${k}\` = ${toRLiteral(val)}`)
    return `list(${entries.join(', ')})`
  }
  return 'NULL'
}

/** Flatten a WebR `toJs()` tree to plain JS: a scalar unwraps, a vector becomes
 * an array, a named list becomes an object. */
function rToJs(o: unknown): unknown {
  if (o === null || typeof o !== 'object') return o
  const r = o as { type?: string; names?: (string | null)[] | null; values?: unknown[] }
  if (Array.isArray(r.values)) {
    if (r.type === 'list' && Array.isArray(r.names) && r.names.some((n) => n != null)) {
      const obj: Record<string, unknown> = {}
      r.names.forEach((n, i) => { obj[n ?? String(i)] = rToJs(r.values?.[i]) })
      return obj
    }
    const vals = r.values.map(rToJs)
    return vals.length === 1 ? vals[0] : vals
  }
  return o
}

async function runR(code: string, ctx: { input?: unknown; variables?: Record<string, unknown>; timeoutMs: number; signal?: AbortSignal }): Promise<CodeRunResult> {
  const webR = await getWebR()

  // Already-aborted on entry: the 'abort' event won't fire again, so interrupt
  // up-front instead of scheduling a run that would ignore the signal.
  if (ctx.signal?.aborted) throw new Error('R code execution aborted')

  const shelter = await new webR.Shelter()
  let timer: ReturnType<typeof setTimeout> | undefined
  const onAbort = (): void => { webR.interrupt() }
  // The real in-flight R eval; awaited in `finally` so an interrupted run fully
  // unwinds on WebR's single worker before the queue releases the next one.
  let capPromise: Promise<RCaptureResult> | undefined
  try {
    // Bind input/vars as generated R literals (prepended), then run the user code.
    const prelude = `input <- ${toRLiteral(ctx.input ?? null)}\nvars <- ${toRLiteral(ctx.variables ?? {})}\n`
    capPromise = shelter.captureR(prelude + code)
    if (ctx.signal !== undefined) ctx.signal.addEventListener('abort', onAbort)
    const cap = await Promise.race([
      capPromise,
      new Promise<RCaptureResult>((_, reject) => {
        timer = setTimeout(() => { webR.interrupt(); reject(new Error(`R code timed out after ${ctx.timeoutMs}ms`)) }, ctx.timeoutMs)
      })
    ])
    const logs = cap.output.filter((o) => o.type === 'stdout').map((o) => o.data)
    const result = rToJs(await cap.result.toJs())
    return { result, logs }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    ctx.signal?.removeEventListener('abort', onAbort)
    // Let the interrupted/settled eval quiesce before purging + releasing the
    // queue, so a timed-out run can't interleave with the next one.
    await capPromise?.catch(() => undefined)
    shelter.purge()
  }
}

export const rRuntime: CodeRuntime = {
  languages: ['r'],
  run(code, ctx) {
    // Serialise on the shared WebR instance.
    const result = queue.then(() => runR(code, ctx))
    queue = result.catch(() => undefined)
    return result
  }
}
