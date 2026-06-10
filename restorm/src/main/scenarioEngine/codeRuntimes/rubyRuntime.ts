/**
 * Ruby runtime — official CRuby compiled to WASM (`ruby.wasm` / `@ruby/wasm-wasi`),
 * run in the shared killable worker. Marshalling between JS and Ruby goes over a
 * JSON bridge: `$input` / `$vars` are `JSON.parse`d from the injected payload,
 * `puts` output is captured by redirecting `$stdout` to a `StringIO`, and the
 * value of the script's last expression is `JSON.generate`d back out (Ruby has
 * no top-level return — the trailing expression is the result, REPL-style).
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { runCodeWorker } from './codeWorkerHarness'
import type { CodeRuntime } from './types'

const RUBY_WORKER_SRC = `
const { parentPort, workerData } = require('node:worker_threads')
const fs = require('node:fs')

let vmReady = null
function getVM() {
  if (vmReady === null) {
    vmReady = (async () => {
      const { DefaultRubyVM } = await import(workerData.rubyGlueUrl)
      const mod = await WebAssembly.compile(fs.readFileSync(workerData.rubyWasmPath))
      const { vm } = await DefaultRubyVM(mod)
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

function resolveRubyPaths(): { rubyGlueUrl: string; rubyWasmPath: string } {
  const req = createRequire(import.meta.url)
  const rubyGlueUrl = pathToFileURL(req.resolve('@ruby/wasm-wasi/dist/node')).href
  // The +stdlib build ships the standard library (json, stringio, …).
  const rubyWasmPath = req.resolve('@ruby/3.4-wasm-wasi/dist/ruby+stdlib.wasm')
  return { rubyGlueUrl, rubyWasmPath }
}

export const rubyRuntime: CodeRuntime = {
  languages: ['ruby'],
  run(code, ctx) {
    return runCodeWorker(RUBY_WORKER_SRC, code, {
      input: ctx.input,
      variables: ctx.variables ?? {},
      timeoutMs: ctx.timeoutMs,
      ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
      workerData: resolveRubyPaths()
    })
  }
}
