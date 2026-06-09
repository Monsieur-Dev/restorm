/**
 * TypeScript / JavaScript runtime — the original QuickJS-WASM sandbox. TS and JS
 * share one engine (esbuild strips types either way), so the language pick is
 * purely an editor concern; both route here. This is also the only runtime that
 * opts into the host network bridge (firewall-routed `fetch` / `pm.sendRequest`).
 */
import type { CodeRuntime } from './types'

export const javascriptRuntime: CodeRuntime = {
  languages: ['typescript', 'javascript'],
  async run(code, ctx) {
    // Lazy: the heavy esbuild + QuickJS deps only load when a JS code node runs.
    const { runCodeInSandbox } = await import('../codeSandbox')
    return runCodeInSandbox({
      code,
      input: ctx.input,
      ...(ctx.variables !== undefined ? { variables: ctx.variables } : {}),
      timeoutMs: ctx.timeoutMs,
      ...(ctx.network !== undefined ? { network: ctx.network } : {}),
      ...(ctx.variableBridge !== undefined ? { variableBridge: ctx.variableBridge } : {}),
      ...(ctx.postman !== undefined ? { postman: ctx.postman } : {}),
      ...(ctx.bruno !== undefined ? { bruno: ctx.bruno } : {}),
      ...(ctx.signal !== undefined ? { signal: ctx.signal } : {})
    })
  }
}
