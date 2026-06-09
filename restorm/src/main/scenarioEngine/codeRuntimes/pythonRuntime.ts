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
 * The worker is created from an inline source string (`eval: true`), so it needs
 * no separate electron-vite build entry; it dynamic-imports `pyodide` from
 * node_modules at runtime (the wasm + stdlib are vendored there).
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { dirname } from 'node:path'
import { runCodeWorker } from './codeWorkerHarness'
import type { CodeRuntime } from './types'

/** Worker body (CommonJS, eval'd). Loads Pyodide lazily and answers each
 * `{ code, input, vars }` with `{ ok, result, logs }`. */
const PYODIDE_WORKER_SRC = `
const { parentPort, workerData } = require('node:worker_threads')

let pyReady = null
function getPyodide() {
  if (pyReady === null) {
    pyReady = import(workerData.pyodideUrl).then((m) => m.loadPyodide({ indexURL: workerData.indexURL }))
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

export const pythonRuntime: CodeRuntime = {
  languages: ['python'],
  run(code, ctx) {
    return runCodeWorker(PYODIDE_WORKER_SRC, code, {
      input: ctx.input,
      variables: ctx.variables ?? {},
      timeoutMs: ctx.timeoutMs,
      ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
      workerData: resolvePyodidePaths()
    })
  }
}
