/**
 * Lua runtime — `wasmoon` (Lua 5.4 compiled to WASM). Tiny + instant-start, but
 * still synchronous, so it runs in the shared killable worker (a runaway
 * `while true do end` is hard-terminated on timeout / Stop).
 *
 * Injection contract: the wired value is the `input` global, run variables are
 * the `vars` table, `print(...)` lines become run-log entries (tab-joined like
 * stock Lua), and the value of the chunk's `return` is the result (Lua chunks
 * yield their value via `return`).
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { runCodeWorker } from './codeWorkerHarness'
import type { CodeRuntime } from './types'

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

parentPort.on('message', async (msg) => {
  const logs = []
  let lua = null
  try {
    const { LuaFactory } = await import(workerData.wasmoonUrl)
    lua = await new LuaFactory().createEngine()
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
  run(code, ctx) {
    return runCodeWorker(LUA_WORKER_SRC, code, {
      input: ctx.input,
      variables: ctx.variables ?? {},
      timeoutMs: ctx.timeoutMs,
      ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
      workerData: { wasmoonUrl: wasmoonUrl() }
    })
  }
}
