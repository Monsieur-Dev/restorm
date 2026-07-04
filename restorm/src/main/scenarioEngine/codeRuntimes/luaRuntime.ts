/**
 * Lua runtime — `wasmoon` (Lua 5.4 compiled to WASM). Tiny + instant-start, but
 * still synchronous, so it runs in the shared killable worker (a runaway
 * `while true do end` is hard-terminated on timeout / Stop).
 *
 * Injection contract: the wired value is the `input` global, run variables are
 * the `vars` table, `print(...)` lines become run-log entries (tab-joined like
 * stock Lua), and the value of the chunk's `return` is the result (Lua chunks
 * yield their value via `return`).
 *
 * External packages (`config.packages`): a pinned LuaRocks module name is
 * resolved to its pure-Lua source ({@link ./luaSource}) and cached as one
 * `<cacheDir>/<name>@<version>/<dotted.module.name>.lua` file per declared
 * module. Before the user code runs, each cached module's source is pushed
 * into wasmoon's `package.preload` — see {@link mountLuaModules}. Each run
 * already spins up a BRAND NEW worker + a brand new `LuaFactory` engine (the
 * pattern below), so mounted modules never leak between independent runs.
 */
import { withFirewallBypass } from 'electron-core-ui'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runCodeWorker } from './codeWorkerHarness'
import { ensurePackagesCached } from './depsInstaller'
import { luaModuleFetcher } from './luaSource'
import { cachedArtifacts } from './depsCache'
import type { CodeRuntime, PackageSpec } from './types'

/** A cached Lua module ready to mount: its dotted name + absolute file path. */
interface CachedLuaModule { name: string; path: string }

/** The slice of wasmoon's `LuaEngine` API {@link mountLuaModules} needs. */
interface LuaEngineLike {
  global: { set(name: string, value: unknown): void }
  doStringSync(code: string): unknown
}

function moduleNameFromFilename(filename: string): string {
  return filename.replace(/\.lua$/i, '')
}

/** Every `.lua` file cached for one pinned package (module name + absolute
 * path). */
function cachedModulesFor(cacheDir: string, spec: PackageSpec): CachedLuaModule[] {
  return cachedArtifacts(cacheDir, spec)
    .filter((p) => p.toLowerCase().endsWith('.lua'))
    .map((p) => ({ name: moduleNameFromFilename(p.split(/[/\\]/).pop() ?? ''), path: p }))
}

/** Every `.lua` module ever cached for the language (skipping the `.manifests`
 * bookkeeping dir other runtimes use) — the whole-cache view {@link
 * mountPackages} mounts for a main-hosted engine (tests). */
function allCachedModules(cacheDir: string): CachedLuaModule[] {
  if (!existsSync(cacheDir)) return []
  const out: CachedLuaModule[] = []
  for (const entry of readdirSync(cacheDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.manifests') continue
    const dir = join(cacheDir, entry.name)
    for (const f of readdirSync(dir)) {
      if (f.toLowerCase().endsWith('.lua')) out.push({ name: moduleNameFromFilename(f), path: join(dir, f) })
    }
  }
  return out
}

/**
 * Register each cached module's source as a `package.preload` loader — used
 * by {@link mountPackages} (a main-hosted engine, e.g. tests) and mirrored
 * inline (the same two-`global.set` + `doStringSync` shape) inside the worker
 * source below, so the two never drift. Both the module name and its source
 * text go through wasmoon's `global.set()` as plain Lua strings — ZERO string
 * interpolation into the Lua chunk itself, so there is no escaping to get
 * wrong and no injection surface regardless of what the source contains.
 */
function mountLuaModules(lua: LuaEngineLike, modules: readonly CachedLuaModule[]): void {
  for (const mod of modules) {
    const source = readFileSync(mod.path, 'utf8')
    lua.global.set('__restormDepName', mod.name)
    lua.global.set('__restormDepSrc', source)
    lua.doStringSync('package.preload[__restormDepName] = assert(load(__restormDepSrc, __restormDepName))')
  }
}

const LUA_WORKER_SRC = `
const { parentPort, workerData } = require('node:worker_threads')

// Lua tables are unordered hashes, and wasmoon iterates their string keys in a
// per-VM hash order that varies between runs — so the same script can yield
// { n, v } one run and { v, n } the next. Recursively sort object keys so a
// table result is deterministic (arrays keep their sequence order). Without
// this, chained Lua nodes + run-log snapshots flake on key order.
function sortKeys(v, seen) {
  seen = seen || new WeakSet()
  if (Array.isArray(v)) {
    if (seen.has(v)) return v
    seen.add(v)
    return v.map((x) => sortKeys(x, seen))
  }
  if (v && typeof v === 'object') {
    if (seen.has(v)) return v // self-referential table → stop, postMessage clones cycles
    seen.add(v)
    const out = {}
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k], seen)
    return out
  }
  return v
}

// Mirrors mountLuaModules() above: same two-global.set + doStringSync shape,
// so the worker path and the main-hosted mountPackages() never drift. No
// string interpolation into the Lua chunk — both the module name and its
// source travel as plain Lua strings via global.set().
function mountModules(lua, modules) {
  if (!modules || modules.length === 0) return
  const fs = require('node:fs')
  for (const m of modules) {
    const source = fs.readFileSync(m.path, 'utf8')
    lua.global.set('__restormDepName', m.name)
    lua.global.set('__restormDepSrc', source)
    lua.doStringSync('package.preload[__restormDepName] = assert(load(__restormDepSrc, __restormDepName))')
  }
}

parentPort.on('message', async (msg) => {
  const logs = []
  let lua = null
  try {
    const { LuaFactory } = await import(workerData.wasmoonUrl)
    lua = await new LuaFactory().createEngine()
    mountModules(lua, workerData.modules)
    // wasmoon can't push a bare null/undefined; an unset Lua global already
    // reads as nil, so just skip it when there's no input.
    if (msg.input !== null && msg.input !== undefined) lua.global.set('input', msg.input)
    lua.global.set('vars', msg.vars || {})
    lua.global.set('print', (...a) => {
      logs.push(a.map((x) => (x === null || x === undefined ? 'nil' : String(x))).join('\\t'))
    })
    // Synchronous run: Lua errors throw cleanly here, and a runaway loop blocks
    // the worker thread (the harness hard-terminates it on timeout).
    const result = lua.doStringSync(msg.code)
    parentPort.postMessage({ ok: true, result: result === undefined ? null : sortKeys(result), logs })
  } catch (e) {
    parentPort.postMessage({ ok: false, error: e && e.message ? String(e.message) : String(e), logs })
  } finally {
    // close() can itself throw on an engine left mid-error — never let that mask
    // the real result/error already posted above.
    try { if (lua) lua.global.close() } catch (_) { /* ignore */ }
  }
})
`

function wasmoonUrl(): string {
  return pathToFileURL(createRequire(import.meta.url).resolve('wasmoon')).href
}

export const luaRuntime: CodeRuntime = {
  languages: ['lua'],

  async installPackages(specs: PackageSpec[], cacheDir: string): Promise<void> {
    // A dependency fetch is trusted, user-initiated provisioning, not sandbox
    // traffic — see ./depsInstaller.
    await withFirewallBypass(() => ensurePackagesCached('lua', cacheDir, specs, luaModuleFetcher))
  },

  mountPackages(engine: unknown, cacheDir: string): Promise<void> {
    // Synchronous mount (a plain file read + a couple of `doStringSync` calls) —
    // still Promise-returning to satisfy the CodeRuntime contract.
    mountLuaModules(engine as LuaEngineLike, allCachedModules(cacheDir))
    return Promise.resolve()
  },

  run(code, ctx) {
    // Resolve the exact modules this run needs (each pinned package's cached
    // `.lua` files) so the worker mounts them offline before the script runs.
    const cacheDir = ctx.packagesCacheDir
    const modules = ctx.packages && cacheDir
      ? ctx.packages.flatMap((spec) => cachedModulesFor(cacheDir, spec))
      : []
    return runCodeWorker(LUA_WORKER_SRC, code, {
      input: ctx.input,
      variables: ctx.variables ?? {},
      timeoutMs: ctx.timeoutMs,
      ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
      workerData: { wasmoonUrl: wasmoonUrl(), modules: modules.map((m) => ({ name: m.name, path: m.path })) }
    })
  }
}
