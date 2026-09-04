/**
 * Provision the Pyodide-DISTRIBUTION wheels the codegen engine needs
 * (jinja2 + markupsafe + pyyaml). markupsafe and pyyaml only exist as
 * emscripten-compiled wheels, so the generic PyPI pure-wheel fetcher
 * can't serve them — they come from the Pyodide package CDN instead,
 * resolved through the VENDORED `pyodide-lock.json` (exact file names +
 * sha256, so the download is integrity-checked against what this exact
 * Pyodide build expects). Cached via the standard deps cache
 * (`ensurePackagesCached`), so the offline-mirror escape hatch and the
 * duplicate-download collapse apply unchanged.
 */

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { withFirewallBypass } from 'electron-core-ui'
import { ensurePackagesCached, httpGetBytes } from '../../scenarioEngine/codeRuntimes/depsInstaller'
import { cachedArtifacts, codeDepsCacheDir, isCached } from '../../scenarioEngine/codeRuntimes/depsCache'
import type { PackageSpec } from '../../scenarioEngine/codeRuntimes/types'

/** The engine's dependency set — jinja2 pulls markupsafe. */
const ENGINE_PACKAGES = ['jinja2', 'markupsafe', 'pyyaml'] as const

/** Cache language key — separate from `python` (these wheels are
 * emscripten-ABI, they must never be mounted into a future non-Pyodide
 * python runtime). */
const CACHE_LANG = 'pyodide-dist'

interface PyodideLockEntry {
  version: string
  file_name: string
  sha256: string
}

interface PyodideLock {
  packages: Record<string, PyodideLockEntry>
}

function pyodideDir(): string {
  const req = createRequire(import.meta.url)
  return dirname(req.resolve('pyodide/package.json'))
}

function readLock(): { lock: PyodideLock; version: string } {
  const dir = pyodideDir()
  const lock = JSON.parse(readFileSync(join(dir, 'pyodide-lock.json'), 'utf8')) as PyodideLock
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version: string }
  return { lock, version: pkg.version }
}

/** The CDN base serving this exact Pyodide build's package wheels. */
function cdnBase(version: string): string {
  return `https://cdn.jsdelivr.net/pyodide/v${version}/full/`
}

function specsFromLock(lock: PyodideLock): { spec: PackageSpec; entry: PyodideLockEntry }[] {
  return ENGINE_PACKAGES.map((name) => {
    const entry = lock.packages[name]
    if (entry === undefined) {
      throw new Error(`pyodide-lock.json misses the codegen engine package "${name}"`)
    }
    return { spec: { name, version: entry.version }, entry }
  })
}

/**
 * Ensure the engine wheels are cached; returns their absolute paths in
 * a stable order. Network only on a cold cache (firewall-bypassed
 * provisioning, SSRF-guarded + sha256-verified).
 */
export async function ensureCodegenWheels(): Promise<string[]> {
  const { lock, version } = readLock()
  const entries = specsFromLock(lock)
  const cacheDir = codeDepsCacheDir(CACHE_LANG)
  const byKey = new Map(entries.map(({ spec, entry }) => [`${spec.name}@${spec.version}`, entry]))

  const missing = entries.filter(({ spec }) => !isCached(cacheDir, spec)).map(({ spec }) => spec)
  if (missing.length > 0) {
    await withFirewallBypass(async () => {
      await ensurePackagesCached(CACHE_LANG, cacheDir, missing, async (spec) => {
        const entry = byKey.get(`${spec.name}@${spec.version}`)
        if (entry === undefined) throw new Error(`no lock entry for ${spec.name}`)
        const data = await httpGetBytes(`${cdnBase(version)}${entry.file_name}`)
        const digest = createHash('sha256').update(data).digest('hex')
        if (digest !== entry.sha256) {
          throw new Error(`sha256 mismatch for ${entry.file_name}: expected ${entry.sha256}, got ${digest}`)
        }
        return [{ filename: entry.file_name, data }]
      })
    })
  }

  return entries.flatMap(({ spec }) => cachedArtifacts(cacheDir, spec))
}
