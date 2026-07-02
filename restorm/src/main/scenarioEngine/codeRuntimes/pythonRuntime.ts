/**
 * Python runtime — CPython compiled to WASM via Pyodide, run in a Node
 * worker_thread (see {@link runCodeWorker}) so a runaway loop can be killed: the
 * harness arms a `SharedArrayBuffer` SIGINT mailbox + a timeout, Pyodide polls
 * it (`setInterruptBuffer`) and raises `KeyboardInterrupt`, and the worker is
 * hard-terminated if it doesn't unwind.
 *
 * Injection contract (mirrors the JS runtime): the wired value is the `input`
 * global, run variables are the `vars` dict, `print(...)` lines become run-log
 * entries, and the **value of the script's last expression** is the result
 * (REPL / notebook-cell semantics — Python has no top-level `return`).
 *
 * External packages (`config.packages`): pinned pure-Python wheels are fetched +
 * their transitive closure resolved in the MAIN process ({@link ./pythonDeps})
 * and cached under `<os-temp>/restorm-code-deps/python`. Before the user code runs, the
 * worker mounts the cached wheels into Pyodide with `loadPackage` — offline, no
 * `micropip` needed (the offline bundle vendors neither micropip nor package
 * wheels). See {@link installPackages} / {@link mountPackages}.
 *
 * The worker is created from an inline source string (`eval: true`), so it needs
 * no separate electron-vite build entry; it dynamic-imports `pyodide` from
 * node_modules at runtime (the wasm + stdlib are vendored there).
 */
import { withFirewallBypass } from 'electron-core-ui'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
import { runCodeWorker } from './codeWorkerHarness'
import { ensurePackagesCached } from './depsInstaller'
import { pythonWheelFetcher, readClosureWheels, resolveTransitiveSpecs, writeClosureManifest } from './pythonDeps'
import { cacheKey } from './depsCache'
import type { CodeRuntime, PackageSpec } from './types'

/** The slice of the Pyodide API {@link mountWheels} uses. */
interface PyodideLike {
  loadPackage(names: readonly string[]): Promise<unknown>
}

/**
 * Mount cached wheels into a loaded Pyodide instance (used by {@link mountPackages}
 * + tests). Pyodide on node/electron installs a wheel directly from its REAL
 * filesystem path — the `emfs:` scheme is NOT honoured in this environment (the
 * loader open()s the literal `emfs:...` string, silently fails, and the package
 * never lands on `sys.path`), so we hand `loadPackage` the absolute cached wheel
 * paths. Fully offline: no micropip, no network. The worker path (below) inlines
 * the SAME one call as literal source, kept in step by the `pythonRuntime` deps
 * tests, so a bundler's helpers can never leak into the worker's eval'd string.
 */
async function mountWheels(py: PyodideLike, wheelPaths: readonly string[]): Promise<void> {
  if (wheelPaths.length === 0) return
  await py.loadPackage(wheelPaths)
}

/** Worker body (CommonJS, eval'd). Loads Pyodide lazily, mounts any cached
 * dependency wheels (offline `loadPackage`), then answers each
 * `{ code, input, vars }` with `{ ok, result, logs }`. */
const PYODIDE_WORKER_SRC = `
const { parentPort, workerData } = require('node:worker_threads')

async function mountWheels(py, wheelPaths) {
  if (!wheelPaths || wheelPaths.length === 0) return
  // node/electron Pyodide installs a wheel straight from its real fs path;
  // 'emfs:' is not honoured here. Offline, no micropip.
  await py.loadPackage(wheelPaths)
}

let pyReady = null
function getPyodide() {
  if (pyReady === null) {
    // Give Pyodide stdout/stderr sinks UP FRONT: loadPackage() (the offline
    // wheel mount below) writes progress to stdout, and in a worker_thread the
    // default fd-based writer throws "fd must be a number" — which would abort
    // the mount and leave the package unimportable. The per-run handler installs
    // the real batched capture later; these just keep install-time output safe.
    pyReady = import(workerData.pyodideUrl)
      .then((m) => m.loadPyodide({ indexURL: workerData.indexURL, stdout: () => {}, stderr: () => {} }))
      .then(async (py) => { await mountWheels(py, workerData.wheelPaths || []); return py })
  }
  return pyReady
}

parentPort.on('message', async (msg) => {
  const logs = []
  try {
    const py = await getPyodide()
    if (workerData.interruptBuffer) py.setInterruptBuffer(workerData.interruptBuffer)
    py.setStdout({ batched: (s) => { logs.push(s) } })
    py.setStderr({ batched: (s) => { logs.push(s) } })
    py.globals.set('input', py.toPy(msg.input === undefined ? null : msg.input))
    py.globals.set('vars', py.toPy(msg.vars || {}))
    const raw = await py.runPythonAsync(msg.code)
    let result = raw
    if (raw !== null && raw !== undefined && typeof raw.toJs === 'function') {
      result = raw.toJs({ dict_converter: Object.fromEntries })
      if (typeof raw.destroy === 'function') raw.destroy()
    }
    parentPort.postMessage({ ok: true, result, logs })
  } catch (e) {
    const message = e && e.message ? String(e.message) : String(e)
    parentPort.postMessage({ ok: false, error: message, logs })
  }
})
`

function resolvePyodidePaths(): { pyodideUrl: string; indexURL: string } {
  const req = createRequire(import.meta.url)
  // The ESM entry — dynamic-imported inside the worker.
  const pyodideUrl = pathToFileURL(req.resolve('pyodide/pyodide.mjs')).href
  // The package dir holds the wasm + python_stdlib.zip the loader reads.
  const indexURL = dirname(req.resolve('pyodide/package.json'))
  return { pyodideUrl, indexURL }
}

/** Every `.whl` file cached under a per-language `cacheDir` (skipping the
 * `.manifests` bookkeeping dir) — the whole-cache view {@link mountPackages}
 * mounts when no per-run closure is given. */
function allCachedWheels(cacheDir: string): string[] {
  if (!existsSync(cacheDir)) return []
  const wheels: string[] = []
  for (const entry of readdirSync(cacheDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.manifests') continue
    const dir = join(cacheDir, entry.name)
    for (const f of readdirSync(dir)) {
      if (f.toLowerCase().endsWith('.whl')) wheels.push(join(dir, f))
    }
  }
  return wheels
}

export const pythonRuntime: CodeRuntime = {
  languages: ['python'],

  async installPackages(specs: PackageSpec[], cacheDir: string): Promise<void> {
    // One firewall-bypass scope covers the top-level downloads AND the transitive
    // PyPI metadata lookups — a dependency fetch is trusted provisioning, not
    // sandbox traffic (see ./depsInstaller).
    await withFirewallBypass(async () => {
      for (const root of specs) {
        // Breadth-first install of the whole transitive closure: cache the
        // current frontier, read its METADATA for the next level, repeat.
        const seen = new Set<string>([cacheKey(root)])
        let frontier: PackageSpec[] = [root]
        while (frontier.length > 0) {
          await ensurePackagesCached('python', cacheDir, frontier, pythonWheelFetcher)
          frontier = await resolveTransitiveSpecs(cacheDir, frontier, seen)
        }
        // Record the closure so a run mounts exactly this package's wheels.
        writeClosureManifest(cacheDir, root, [...seen])
      }
    })
  },

  async mountPackages(engine: unknown, cacheDir: string): Promise<void> {
    await mountWheels(engine as PyodideLike, allCachedWheels(cacheDir))
  },

  run(code, ctx) {
    // Resolve the exact wheels this run needs (each pinned package's cached
    // closure) so the worker mounts them offline before the script runs.
    const cacheDir = ctx.packagesCacheDir
    const wheelPaths = ctx.packages && cacheDir
      ? [...new Set(ctx.packages.flatMap((spec) => readClosureWheels(cacheDir, spec)))]
      : []
    return runCodeWorker(PYODIDE_WORKER_SRC, code, {
      input: ctx.input,
      variables: ctx.variables ?? {},
      timeoutMs: ctx.timeoutMs,
      ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
      workerData: { ...resolvePyodidePaths(), wheelPaths }
    })
  }
}
