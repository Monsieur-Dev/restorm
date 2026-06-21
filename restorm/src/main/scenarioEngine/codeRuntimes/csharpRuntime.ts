/**
 * C# runtime — .NET compiled to WASM (`dotnet.wasm` + the Roslyn scripting
 * assemblies), run in the shared killable worker. Unlike Pyodide / wasmoon /
 * ruby.wasm / WebR there is no npm package that ships a .NET WASM runtime with a
 * C#-eval entry point, so the runtime is a PREBUILT bundle VENDORED INTO THE REPO
 * under `resources/dotnet-wasm/` (the `_framework` output of a small wasmbrowser
 * library — built once with the .NET SDK + `wasm-tools`, see
 * `docs/contributing/building-the-csharp-wasm-bundle.md`). The build/CI host
 * needs no .NET SDK; electron-builder ships the dir via `extraResources`
 * (→ `process.resourcesPath/restorm-resources/dotnet-wasm`), the same convention
 * `features.yaml` / `settings.yaml` already use.
 *
 * Injection contract (mirrors the JS / Python / Ruby runtimes): the wired value
 * is the `input` global, run variables are the `vars` dictionary, `Console.Write`
 * / `Console.WriteLine` output becomes run-log lines, and the value of the
 * script's last expression is the result (Roslyn C# scripting / REPL semantics —
 * a top-level trailing expression yields the submission's value). The bundle's
 * `[JSExport] Eval(code, inputJson, varsJson)` marshals over a JSON bridge and
 * returns `{ result, logs }` as JSON, so the host never touches managed objects.
 *
 * Sandboxed + no network by default (AC#2): the vendored eval host references
 * only the Roslyn + BCL stdlib, exposes no `fetch` / socket bridge, and runs in
 * the worker with the harness's memory cap + timeout / Stop kill.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { runCodeWorker } from './codeWorkerHarness'
import type { CodeRuntime } from './types'

/** The vendored bundle's boot entry (its `_framework/dotnet.js`) and the boot
 * manifest the runtime reads to find its sibling `dotnet.wasm` / `*.dll` assets. */
const DOTNET_ENTRY = 'dotnet.js'
const BOOT_CONFIG = 'blazor.boot.json'

/** Worker body (CommonJS, eval'd). Boots the .NET WASM runtime lazily and
 * answers each `{ code, input, vars }` with `{ ok, result, logs }`. The dotnet
 * host glue is ESM, so it's reached via dynamic `import()`; `getAssemblyExports`
 * surfaces the `[JSExport]` eval entry point. */
const CSHARP_WORKER_SRC = `
const { parentPort, workerData } = require('node:worker_threads')

let exportsReady = null
function getExports() {
  if (exportsReady === null) {
    exportsReady = (async () => {
      const { dotnet } = await import(workerData.dotnetUrl)
      // The runtime resolves its sibling assets (dotnet.wasm, *.dll, the ICU
      // data) relative to the bundle dir; point it at the vendored boot config
      // so it loads fully offline (no CDN), like WebR / Pyodide from node_modules.
      const { getAssemblyExports, getConfig } = await dotnet
        .withConfigSrc(workerData.bootConfigUrl)
        .create()
      const config = getConfig()
      return await getAssemblyExports(config.mainAssemblyName)
    })()
  }
  return exportsReady
}

parentPort.on('message', async (msg) => {
  try {
    const api = await getExports()
    const inputJson = JSON.stringify(msg.input === undefined ? null : msg.input)
    const varsJson = JSON.stringify(msg.vars || {})
    // The managed Eval returns a JSON string { "result": ..., "logs": [...] }.
    const raw = api.RestormCsharpEval.Evaluator.Eval(msg.code, inputJson, varsJson)
    const parsed = JSON.parse(raw)
    if (parsed && parsed.error) {
      parentPort.postMessage({ ok: false, error: String(parsed.error), logs: Array.isArray(parsed.logs) ? parsed.logs : [] })
      return
    }
    const logs = Array.isArray(parsed.logs) ? parsed.logs.map((l) => String(l)) : []
    parentPort.postMessage({ ok: true, result: parsed.result, logs })
  } catch (e) {
    const message = e && e.message ? String(e.message) : String(e)
    parentPort.postMessage({ ok: false, error: message, logs: [] })
  }
})
`

interface CsharpPaths { dotnetUrl: string; bootConfigUrl: string }

/** Candidate locations of the vendored `dotnet-wasm` bundle dir, covering every
 * execution context without hard-coding a fragile relative depth (the module's
 * `import.meta.url` lands at different depths: `src/main/scenarioEngine/
 * codeRuntimes` under vitest, `dist/main/chunks` in the electron-vite build,
 * `dist/main` could shift again). Instead of fixed `../../`-counts we walk
 * UPWARD from the module dir looking for a `restorm/resources/dotnet-wasm`, then
 * add the packaged location. Mirrors how the main process resolves
 * `features.yaml` / `settings.yaml`, but layout-proof.
 *  - DEV / VITEST / electron-vite build: the first ancestor that contains
 *    `resources/dotnet-wasm` (the committed repo dir under `restorm/`).
 *  - PROD (electron-builder): `process.resourcesPath/restorm-resources/dotnet-wasm`,
 *    where `extraResources` copies the dir.
 * `existsSync` picks the first that actually holds the bundle. `process
 * .resourcesPath` is an Electron-set Node global (undefined under vitest), so the
 * module stays electron-import-free + unit-testable. */
function bundleDirCandidates(): string[] {
  const candidates: string[] = []
  // Walk ancestors of the module dir; the repo bundle lives at
  // `<…>/restorm/resources/dotnet-wasm` regardless of how deep the compiled
  // module sits under `restorm/`.
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 8; i++) {
    candidates.push(join(dir, 'resources/dotnet-wasm'))
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (typeof resourcesPath === 'string' && resourcesPath.length > 0) {
    candidates.push(join(resourcesPath, 'restorm-resources/dotnet-wasm'))
  }
  return candidates
}

/** Resolve the vendored bundle's `dotnet.js` boot entry + its boot config.
 * Throws a precise, actionable error naming the searched paths when the prebuilt
 * bundle isn't vendored yet (a fresh checkout), rather than a cryptic import
 * failure deep inside the worker at first run. */
function resolveCsharpPaths(): CsharpPaths {
  const candidates = bundleDirCandidates()
  for (const dir of candidates) {
    const entry = join(dir, DOTNET_ENTRY)
    if (existsSync(entry)) {
      return {
        dotnetUrl: pathToFileURL(entry).href,
        bootConfigUrl: pathToFileURL(join(dir, BOOT_CONFIG)).href
      }
    }
  }
  throw new Error(
    `C# runtime unavailable: the prebuilt .NET WASM bundle is missing at ${candidates.join(' / ')}. ` +
    'Vendor it under resources/dotnet-wasm (built once with the .NET SDK + wasm-tools — ' +
    'see docs/contributing/building-the-csharp-wasm-bundle.md).'
  )
}

export const csharpRuntime: CodeRuntime = {
  languages: ['csharp'],
  // Resolve the vendored bundle inside the returned promise so a missing bundle
  // surfaces as a rejection (like any other run error), not a synchronous throw.
  async run(code, ctx) {
    const paths = resolveCsharpPaths()
    return runCodeWorker(CSHARP_WORKER_SRC, code, {
      input: ctx.input,
      variables: ctx.variables ?? {},
      timeoutMs: ctx.timeoutMs,
      ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
      workerData: paths
    })
  }
}
