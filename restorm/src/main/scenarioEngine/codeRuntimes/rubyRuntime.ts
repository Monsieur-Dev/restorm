/**
 * Ruby runtime — official CRuby compiled to WASM (`ruby.wasm` / `@ruby/wasm-wasi`),
 * run in the shared killable worker. Marshalling between JS and Ruby goes over a
 * JSON bridge: `$input` / `$vars` are `JSON.parse`d from the injected payload,
 * `puts` output is captured by redirecting `$stdout` to a `StringIO`, and the
 * value of the script's last expression is `JSON.generate`d back out (Ruby has
 * no top-level return — the trailing expression is the result, REPL-style).
 *
 * External packages (`config.packages`): pinned pure-Ruby gems and their
 * transitive closure are resolved + extracted in the MAIN process
 * ({@link ./rubyGemSource}) and cached under `<os-temp>/restorm-code-deps/ruby`.
 * ruby.wasm's WASI filesystem only exposes explicitly preopened host
 * directories, so — unlike Pyodide's `loadPackage`, which mounts into an
 * already-running engine — the gem cache must be preopened at VM CONSTRUCTION
 * time. The worker preopens the run's `packagesCacheDir` at the fixed guest
 * path `/gems` and unshifts each resolved gem's `require_paths` onto
 * `$LOAD_PATH` right after building the VM, before the user script runs. See
 * {@link installPackages} / {@link mountPackages}.
 */
import { withFirewallBypass } from 'electron-core-ui'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { existsSync, readdirSync } from 'node:fs'
import { runCodeWorker } from './codeWorkerHarness'
import { ensurePackagesCached } from './depsInstaller'
import { cacheKey, isCached } from './depsCache'
import {
  ensureExtracted,
  isClosureReady,
  readClosureGems,
  resolveTransitiveSpecs,
  rubyGemFetcher,
  writeClosureManifest,
  type RubyClosureGem
} from './rubyGemSource'
import type { CodeRuntime, PackageSpec } from './types'

/** Fixed WASI guest mount point the worker preopens the run's gem cache
 * directory at — every `$LOAD_PATH` entry is relative to this. */
const GEMS_GUEST_ROOT = '/gems'

const RUBY_WORKER_SRC = `
const { parentPort, workerData } = require('node:worker_threads')
const fs = require('node:fs')
const { WASI } = require('node:wasi')

let vmReady = null
function getVM() {
  if (vmReady === null) {
    vmReady = (async () => {
      const { RubyVM } = await import(workerData.rubyVmUrl)
      const mod = await WebAssembly.compile(fs.readFileSync(workerData.rubyWasmPath))
      const wasiOptions = { version: 'preview1', returnOnExit: true }
      if (workerData.gemsHostDir) wasiOptions.preopens = { '${GEMS_GUEST_ROOT}': workerData.gemsHostDir }
      const wasi = new WASI(wasiOptions)
      const { vm } = await RubyVM.instantiateModule({ module: mod, wasip1: wasi })
      if (workerData.loadPathEval) vm.eval('$LOAD_PATH.unshift(' + workerData.loadPathEval + ')')
      return vm
    })()
  }
  return vmReady
}

// Wrap the user script: parse input/vars from JSON (heredocs dodge escaping),
// capture puts via a StringIO, run the body, and emit { result, logs } as JSON.
function wrap(code, inputJson, varsJson) {
  return [
    'require "json"',
    'require "stringio"',
    '$input = JSON.parse(<<\\'__RESTORM_IN__\\')\\n' + inputJson + '\\n__RESTORM_IN__',
    '$vars = JSON.parse(<<\\'__RESTORM_VARS__\\')\\n' + varsJson + '\\n__RESTORM_VARS__',
    '__restorm_buf = StringIO.new',
    '$stdout = __restorm_buf',
    '__restorm_result = begin',
    code,
    'end',
    '$stdout = STDOUT',
    'JSON.generate({"result" => __restorm_result, "logs" => __restorm_buf.string})'
  ].join('\\n')
}

parentPort.on('message', async (msg) => {
  try {
    const vm = await getVM()
    const inputJson = JSON.stringify(msg.input === undefined ? null : msg.input)
    const varsJson = JSON.stringify(msg.vars || {})
    const raw = vm.eval(wrap(msg.code, inputJson, varsJson)).toString()
    const parsed = JSON.parse(raw)
    const logs = typeof parsed.logs === 'string' && parsed.logs.length > 0
      ? parsed.logs.replace(/\\n$/, '').split('\\n')
      : []
    parentPort.postMessage({ ok: true, result: parsed.result, logs })
  } catch (e) {
    const message = e && e.message ? String(e.message) : String(e)
    parentPort.postMessage({ ok: false, error: message, logs: [] })
  }
})
`

function resolveRubyPaths(): { rubyVmUrl: string; rubyWasmPath: string } {
  const req = createRequire(import.meta.url)
  const rubyVmUrl = pathToFileURL(req.resolve('@ruby/wasm-wasi/dist/vm')).href
  // The +stdlib build ships the standard library (json, stringio, …).
  const rubyWasmPath = req.resolve('@ruby/3.4-wasm-wasi/dist/ruby+stdlib.wasm')
  return { rubyVmUrl, rubyWasmPath }
}

/** Build the `$LOAD_PATH.unshift(...)` argument list (guest-side, relative to
 * {@link GEMS_GUEST_ROOT}) for a resolved set of closure members. Empty when
 * there is nothing to mount. */
function loadPathLiteral(members: readonly RubyClosureGem[]): string {
  const paths = members.flatMap((m) => m.requirePaths.map((rp) => `${GEMS_GUEST_ROOT}/${m.name}@${m.version}/${rp}`))
  return paths.map((p) => JSON.stringify(p)).join(', ')
}

function dedupeByKey(members: readonly RubyClosureGem[]): RubyClosureGem[] {
  const seen = new Set<string>()
  const out: RubyClosureGem[] = []
  for (const m of members) {
    const key = `${m.name}@${m.version}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(m)
  }
  return out
}

/** Every gem cached under `cacheDir` (skipping the `.manifests` bookkeeping
 * dir), extracted if needed — the whole-cache view {@link mountPackages} mounts
 * for a main-hosted engine / tests. A malformed/partial entry is skipped
 * rather than failing the others. */
function allCachedGems(cacheDir: string): RubyClosureGem[] {
  if (!existsSync(cacheDir)) return []
  const out: RubyClosureGem[] = []
  for (const entry of readdirSync(cacheDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.manifests') continue
    const at = entry.name.lastIndexOf('@')
    if (at < 0) continue
    const spec: PackageSpec = { name: entry.name.slice(0, at), version: entry.name.slice(at + 1) }
    if (!isCached(cacheDir, spec)) continue
    try {
      const gemspec = ensureExtracted(cacheDir, spec)
      out.push({ name: spec.name, version: spec.version, requirePaths: gemspec.requirePaths })
    } catch { /* skip a malformed entry — not fatal for the others */ }
  }
  return out
}

export const rubyRuntime: CodeRuntime = {
  languages: ['ruby'],

  async installPackages(specs: PackageSpec[], cacheDir: string): Promise<void> {
    // One firewall-bypass scope covers the top-level downloads AND the
    // transitive RubyGems metadata lookups — a dependency fetch is trusted
    // provisioning, not sandbox traffic (see ./depsInstaller).
    await withFirewallBypass(async () => {
      for (const root of specs) {
        // Fully cached + extracted already → skip resolution entirely, no
        // network at all (not just a per-artifact cache-hit check).
        if (isClosureReady(cacheDir, root)) continue
        const seen = new Set<string>([cacheKey(root)])
        const requirePathsByKey = new Map<string, string[]>()
        let frontier: PackageSpec[] = [root]
        while (frontier.length > 0) {
          await ensurePackagesCached('ruby', cacheDir, frontier, rubyGemFetcher)
          for (const spec of frontier) requirePathsByKey.set(cacheKey(spec), ensureExtracted(cacheDir, spec).requirePaths)
          frontier = await resolveTransitiveSpecs(cacheDir, frontier, seen)
        }
        // Record the closure so a run mounts exactly this package's gems, and a
        // later install can confirm "already done" without touching the network.
        const entries = [...seen].map((key) => ({ key, requirePaths: requirePathsByKey.get(key) ?? ['lib'] }))
        writeClosureManifest(cacheDir, root, entries)
      }
    })
  },

  // Synchronous (unlike the Python runtime's mountPackages, which awaits
  // Pyodide's own loader) — mounting is just a `$LOAD_PATH.unshift` eval — but
  // the {@link CodeRuntime} contract is `Promise<void>` for every runtime.
  mountPackages(engine: unknown, cacheDir: string): Promise<void> {
    // Precondition (documented, not enforceable here): `engine`'s WASI must
    // already preopen `cacheDir` at the guest path `/gems` — ruby.wasm can't
    // grant filesystem access to an already-running VM, only mutate
    // `$LOAD_PATH` within what's already visible to it.
    const literal = loadPathLiteral(allCachedGems(cacheDir))
    if (literal !== '') (engine as { eval(code: string): unknown }).eval(`$LOAD_PATH.unshift(${literal})`)
    return Promise.resolve()
  },

  run(code, ctx) {
    // Resolve the exact gems this run needs (each pinned package's cached
    // closure) so the worker mounts them offline before the script runs.
    const cacheDir = ctx.packagesCacheDir
    const members = ctx.packages && cacheDir ? dedupeByKey(ctx.packages.flatMap((spec) => readClosureGems(cacheDir, spec))) : []
    return runCodeWorker(RUBY_WORKER_SRC, code, {
      input: ctx.input,
      variables: ctx.variables ?? {},
      timeoutMs: ctx.timeoutMs,
      ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
      workerData: {
        ...resolveRubyPaths(),
        ...(members.length > 0 && cacheDir !== undefined
          ? { gemsHostDir: cacheDir, loadPathEval: loadPathLiteral(members) }
          : {})
      }
    })
  }
}
