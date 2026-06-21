/**
 * Wires every `code`-node language runtime into the registry. Importing this
 * module registers them as a side effect; the executor imports it lazily before
 * resolving a runtime. New languages are added here (plus their runtime file).
 */
import { registerCodeRuntime } from './registry'
import { javascriptRuntime } from './javascriptRuntime'
import { pythonRuntime } from './pythonRuntime'
import { luaRuntime } from './luaRuntime'
import { rubyRuntime } from './rubyRuntime'
import { rRuntime } from './rRuntime'
import { csharpRuntime } from './csharpRuntime'

let installed = false

/** Idempotently register all runtimes. Cheap (runtimes load their heavy WASM
 * engines lazily on first `run`), so calling it per code-node execution is fine. */
export function ensureCodeRuntimes(): void {
  if (installed) return
  installed = true
  registerCodeRuntime(javascriptRuntime)
  registerCodeRuntime(pythonRuntime)
  registerCodeRuntime(luaRuntime)
  registerCodeRuntime(rubyRuntime)
  registerCodeRuntime(rRuntime)
  registerCodeRuntime(csharpRuntime)
}

export { getCodeRuntime, registeredCodeLanguages } from './registry'
export type { CodeRuntime, CodeRunContext, CodeRunResult } from './types'

// Re-export for the executor's convenience.
export { ensureCodeRuntimes as default }
