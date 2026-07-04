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
 *
 * External packages (`config.packages`): pinned CRAN packages are resolved
 * against the WebR WASM binary repo, downloaded + cached in the MAIN process
 * ({@link ./webrInstall}), then extracted and `FS.mount('NODEFS', …)`-ed
 * straight into the running WebR singleton's virtual filesystem — offline,
 * no `webr::install()` / network call from inside WebR itself. Unlike the
 * Pyodide runtime (a fresh worker per run), WebR is ONE persistent
 * interpreter for the app's lifetime, so `mountRPackages` mounts the WHOLE
 * cache once (idempotent) rather than a per-run closure, and both
 * `installPackages` and mounting are serialised through the same `queue` as
 * every R eval.
 */
import { withFirewallBypass } from 'electron-core-ui'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { ensurePackagesCached } from './depsInstaller'
import { cacheKey, isCached } from './depsCache'
import { allCachedSpecs, ensureExtracted, fetchPackagesIndex, makeRWasmFetcher, resolveTransitiveSpecs } from './webrInstall'
import type { CodeRunContext, CodeRuntime, CodeRunResult, PackageSpec } from './types'

/** The slice of the WebR API this runtime drives (the package's own types aren't
 * imported to keep the dynamic-import boundary clean). */
interface RCaptureResult { output: { type: string; data: string }[]; result: { toJs: () => Promise<unknown> } }
interface RShelter { captureR: (code: string) => Promise<RCaptureResult>; purge: () => void }
interface WebRFS {
  mkdir: (path: string) => Promise<unknown>
  mount: (type: 'NODEFS', options: { root: string }, mountpoint: string) => Promise<void>
}
interface WebRInstance {
  init: () => Promise<void>
  interrupt: () => void
  Shelter: new () => Promise<RShelter>
  /** The bundled R version (e.g. `"4.6.0"`) — used to derive the WebR WASM
   * binary repo's contrib path. */
  versionR: string
  FS: WebRFS
  evalRVoid: (code: string) => Promise<void>
}

// WebR is single-R-worker; serialise runs through one instance + a queue so
// concurrent code nodes don't interleave on the shared interpreter.
let webRSingleton: Promise<WebRInstance> | null = null
let queue: Promise<unknown> = Promise.resolve()

function getWebR(): Promise<WebRInstance> {
  webRSingleton ??= (async () => {
    const { WebR } = await import('webr') as unknown as {
      WebR: new (opts: { baseUrl: string; createLazy?: boolean }) => WebRInstance
    }
    const baseUrl = `${dirname(createRequire(import.meta.url).resolve('webr'))}/`
    // R runs on a shared WebR singleton in its own Emscripten worker.
    // Unlike the Node-worker runtimes (codeWorkerHarness, which now bounds
    // memory via resourceLimits), WebR exposes no hard heap cap — its
    // Emscripten module manages its own linear memory and the public
    // WebROptions has no max-memory field. The protections that DO apply:
    // the per-run timeout + the SIGINT interrupt (below) abort a runaway
    // R eval, and WebR's worker is a separate process from the main heap,
    // so an R OOM crashes the WebR worker (surfaced as a run error) rather
    // than the main process. A hard WebR memory ceiling would need an
    // upstream WebR option (tracked as a follow-up, not a code-quality fix).
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

/** Packages already `FS.mount('NODEFS', …)`-ed into the WebR VFS this
 * session — mounting is a one-time, idempotent operation per package: WebR is
 * a persistent singleton (unlike Pyodide's fresh worker-per-run), so nothing
 * needs remounting between runs. */
const mountedKeys = new Set<string>()
/** Memoises the one-time creation of the `/restorm-lib` mount root. */
let libRootReady: Promise<void> | undefined

/** Extract + `FS.mount('NODEFS', …)` every package cached under `cacheDir`
 * that isn't mounted yet, and prepend each mount's path to R's `.libPaths()`
 * so `library(<pkg>)` resolves it. Mounts the WHOLE cache rather than a
 * per-run closure (see the module header) — a no-op once every cached
 * package has already been mounted. */
async function mountRPackages(webR: WebRInstance, cacheDir: string): Promise<void> {
  const pending = allCachedSpecs(cacheDir).filter((spec) => !mountedKeys.has(cacheKey(spec)))
  if (pending.length === 0) return
  libRootReady ??= webR.FS.mkdir('/restorm-lib').then(() => undefined)
  await libRootReady
  for (const spec of pending) {
    const key = cacheKey(spec)
    const mountpoint = `/restorm-lib/${key}`
    await webR.FS.mkdir(mountpoint)
    await webR.FS.mount('NODEFS', { root: ensureExtracted(cacheDir, spec) }, mountpoint)
    // Prepend so a pinned package always wins over a same-named base-R entry.
    await webR.evalRVoid(`.libPaths(c(${JSON.stringify(mountpoint)}, .libPaths()))`)
    mountedKeys.add(key)
  }
}

/** Fetch + cache the transitive closure of every pinned spec — resolved from
 * ONE `PACKAGES` index fetch (see `./webrInstall`), BFS level by level so
 * each level's artifacts are cached before its own dependencies are read. A
 * root that's already fully cached (its `.tgz` present — the whole closure
 * was necessarily completed before that artifact was written) is skipped
 * BEFORE the index is even fetched, so a full cache hit across every pinned
 * root touches the network not at all, not even for the registry index. */
async function installRPackages(specs: PackageSpec[], cacheDir: string): Promise<void> {
  const uncachedRoots = specs.filter((spec) => !isCached(cacheDir, spec))
  if (uncachedRoots.length === 0) return
  const webR = await getWebR()
  await withFirewallBypass(async () => {
    const { index, contribUrl } = await fetchPackagesIndex(webR.versionR)
    const fetcher = makeRWasmFetcher(index, contribUrl)
    for (const root of uncachedRoots) {
      const seen = new Set<string>([cacheKey(root)])
      let frontier: PackageSpec[] = [root]
      while (frontier.length > 0) {
        await ensurePackagesCached('r', cacheDir, frontier, fetcher)
        frontier = resolveTransitiveSpecs(index, frontier, seen)
      }
    }
  })
}

async function runR(code: string, ctx: CodeRunContext): Promise<CodeRunResult> {
  const webR = await getWebR()
  if (ctx.packagesCacheDir !== undefined) await mountRPackages(webR, ctx.packagesCacheDir)

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

  installPackages(specs, cacheDir) {
    // Serialise on the shared WebR instance/queue like every other WebR
    // operation (AC: install must not race a concurrent R eval or mount).
    const result = queue.then(() => installRPackages(specs, cacheDir))
    queue = result.catch(() => undefined)
    return result
  },

  async mountPackages(engine, cacheDir) {
    await mountRPackages(engine as WebRInstance, cacheDir)
  },

  run(code, ctx) {
    // Serialise on the shared WebR instance.
    const result = queue.then(() => runR(code, ctx))
    queue = result.catch(() => undefined)
    return result
  }
}
