/**
 * Packaged-app escape hatch for the esbuild BINARY.
 *
 * esbuild's JS API spawns a native service binary it resolves through
 * `require.resolve('@esbuild/<platform>-<arch>/...')`. In a packaged app that
 * resolution lands INSIDE `app.asar` — and while Electron patches `fs` (and
 * `execFile`) to read through the archive, plain `child_process.spawn` is NOT
 * patched, so esbuild dies with `spawn ENOTDIR` (the archive is a file, not a
 * directory). electron-builder DOES unpack the binary next to the archive
 * (`app.asar.unpacked`); esbuild just never looks there. `ESBUILD_BINARY_PATH`
 * is esbuild's documented override — BUT it reads it once, at module load, so
 * the bootstrap (`esbuildBinaryPathBootstrap`) must run before anything can
 * import esbuild.
 */

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/** Map a path inside an asar archive to its `app.asar.unpacked` sibling.
 * Returns the input unchanged when no `.asar/` segment is present. */
export function toAsarUnpackedPath(p: string): string {
  return p.replace(/\.asar([\\/])/, '.asar.unpacked$1')
}

/** Resolve `@esbuild/<platform>-<arch>/package.json` the way esbuild itself
 * finds it: FROM the `esbuild` package (under pnpm's isolated store the
 * platform package is a transitive dep of `esbuild`, not a top-level link —
 * same pnpm trap `TypeSpecImportService` documents). */
export function resolvePlatformPackageJson(): string {
  const requireFromHere = createRequire(import.meta.url)
  const esbuildPkgJson = requireFromHere.resolve('esbuild/package.json')
  const requireFromEsbuild = createRequire(esbuildPkgJson)
  return requireFromEsbuild.resolve(`@esbuild/${process.platform}-${process.arch}/package.json`)
}

let ensured = false

/** Idempotent: when running from an asar archive, point `ESBUILD_BINARY_PATH`
 * at the unpacked native binary so esbuild's spawn works. No-ops in dev (no
 * asar in the resolved path), when the caller already set the variable, or
 * when the unpacked binary is missing (leaves esbuild's own resolution — and
 * its own clearer error — untouched). `resolve` is injectable for tests. */
export function ensureEsbuildBinaryResolvable(resolve: () => string = resolvePlatformPackageJson): void {
  if (ensured || process.env.ESBUILD_BINARY_PATH) return
  ensured = true
  let pkgJsonPath: string
  try {
    pkgJsonPath = resolve()
  } catch {
    return
  }
  if (!/\.asar[\\/]/.test(pkgJsonPath)) return
  const pkgDir = dirname(pkgJsonPath)
  // Windows ships the binary at the package root; every other platform under bin/.
  const binary = process.platform === 'win32' ? join(pkgDir, 'esbuild.exe') : join(pkgDir, 'bin', 'esbuild')
  const unpacked = toAsarUnpackedPath(binary)
  if (existsSync(unpacked)) process.env.ESBUILD_BINARY_PATH = unpacked
}

/** Test hook: forget the ensured latch so the next call re-evaluates. */
export function resetEsbuildBinaryLatchForTests(): void {
  ensured = false
}
