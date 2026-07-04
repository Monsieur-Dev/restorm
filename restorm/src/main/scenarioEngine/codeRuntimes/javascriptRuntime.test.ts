// @vitest-environment node
// esbuild (transitively pulled in by `installPackages`/`mountPackages` bundling
// a user package) trips over jsdom's cross-realm `TextEncoder` — see
// `codeSandbox.test.ts` for the same override.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { javascriptRuntime } from './javascriptRuntime'
import { packageDir } from './depsCache'

describe('javascriptRuntime — external packages wiring', () => {
  let cacheDir = ''
  beforeEach(() => { cacheDir = mkdtempSync(join(tmpdir(), 'js-runtime-deps-')) })
  afterEach(() => { rmSync(cacheDir, { recursive: true, force: true }) })

  it('installPackages resolves as a no-op for an empty spec list', async () => {
    await expect(javascriptRuntime.installPackages?.([], cacheDir)).resolves.toBeUndefined()
  })

  it('mountPackages is a no-op against an empty cache', async () => {
    const evalCode = (): never => { throw new Error('should not be called — nothing cached') }
    await expect(javascriptRuntime.mountPackages?.({ evalCode }, cacheDir)).resolves.toBeUndefined()
  })

  it('run() threads config.packages + packagesCacheDir through to the sandbox', async () => {
    const spec = { name: 'just-snake-case', version: '1.0.0' }
    mkdirSync(packageDir(cacheDir, spec), { recursive: true })
    writeFileSync(join(packageDir(cacheDir, spec), 'bundle.js'), "var __pkgExports = (function(s){ return s.toUpperCase() });")
    const { result } = await javascriptRuntime.run("return just_snake_case('hi')", {
      timeoutMs: 5000,
      packages: [spec],
      packagesCacheDir: cacheDir
    })
    expect(result).toBe('HI')
  })
})
