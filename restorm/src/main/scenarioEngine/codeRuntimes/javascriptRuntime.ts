/**
 * TypeScript / JavaScript runtime — the original QuickJS-WASM sandbox. TS and JS
 * share one engine (esbuild strips types either way), so the language pick is
 * purely an editor concern; both route here. This is also the only runtime that
 * opts into the host network bridge (firewall-routed `fetch` / `pm.sendRequest`).
 *
 * External packages (`config.packages`): a pinned npm package is fetched +
 * esbuild-bundled by {@link ../codeRuntimes/npmBundle} into a cached `bundle.js`
 * (one per package, keyed like every other runtime's cache). `run` just passes
 * the pinned specs + cache dir through to `codeSandbox.runCodeInSandbox`, which
 * injects the cached bundles as a SECOND prelude, after the curated stdlib one.
 */
import type { CodeRuntime, PackageSpec } from './types'

export const javascriptRuntime: CodeRuntime = {
  languages: ['typescript', 'javascript'],

  async installPackages(specs: PackageSpec[], cacheDir: string): Promise<void> {
    const { ensurePackagesCached } = await import('./depsInstaller')
    const { npmBundleFetcher } = await import('./npmBundle')
    await ensurePackagesCached('javascript', cacheDir, specs, npmBundleFetcher)
  },

  async mountPackages(engine: unknown, cacheDir: string): Promise<void> {
    // Exposed for tests against a real QuickJS context (mirrors pythonRuntime):
    // production runs inject the SAME cached bundles inline in codeSandbox.ts
    // instead, since a fresh QuickJS context is created per run anyway.
    const { mountPackagesIntoContext } = await import('./npmBundle')
    await mountPackagesIntoContext(engine, cacheDir)
  },

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
      ...(ctx.runRequest !== undefined ? { runRequest: ctx.runRequest } : {}),
      ...(ctx.packages !== undefined ? { packages: ctx.packages } : {}),
      ...(ctx.packagesCacheDir !== undefined ? { packagesCacheDir: ctx.packagesCacheDir } : {}),
      ...(ctx.signal !== undefined ? { signal: ctx.signal } : {})
    })
  }
}
