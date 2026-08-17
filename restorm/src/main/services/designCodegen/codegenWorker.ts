/**
 * The codegen-specific Pyodide worker source — a sibling of the scenario
 * python runtime's worker (`PYODIDE_WORKER_SRC`), but hardened for
 * UNTRUSTED input: a third-party template (and its `hooks/*.py`, which
 * `exec` arbitrary Python by design) must not reach the host.
 *
 * The guarantee is taken at the RUNTIME level, not by masking a name:
 * `loadPyodide({ jsglobals })` hands the invited code a frozen, EMPTY
 * `js` module. A hook that does `del sys.modules['js']; import js` — the
 * `sys.modules` poisoning bypass — gets that same empty object back, not
 * the worker's real `globalThis`, so `js.process` (and every other host
 * capability) is simply absent. `pyodide.ffi` stays importable but has
 * no JS globals to reach either.
 *
 * Kept in a separate file (never inlined into the shared runtime) so the
 * scenario python runtime — which runs USER-OWNED code and legitimately
 * keeps its bridge — is untouched.
 */

/** Worker body (CommonJS, eval'd) — loads Pyodide with an empty
 * `jsglobals`, mounts the offline engine wheels, then answers each
 * `{ code, input, vars }` with `{ ok, result, logs }`. */
export const CODEGEN_WORKER_SRC = `
const { parentPort, workerData } = require('node:worker_threads')

async function mountWheels(py, wheelPaths) {
  if (!wheelPaths || wheelPaths.length === 0) return
  await py.loadPackage(wheelPaths)
}

let pyReady = null
function getPyodide() {
  if (pyReady === null) {
    // The invited code's ONLY \`js\` — frozen + empty, so a hook cannot
    // reach the host process even by clearing sys.modules and
    // re-importing (the finder returns this object, not real globals).
    const jsglobals = Object.freeze(Object.create(null))
    pyReady = import(workerData.pyodideUrl)
      .then((m) => m.loadPyodide({ indexURL: workerData.indexURL, jsglobals, stdout: () => {}, stderr: () => {} }))
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
