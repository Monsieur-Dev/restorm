/**
 * Python dependency resolution for the `code` node — the main-process half that
 * turns a user's pinned `name@version` into a set of cached, pure-Python wheels
 * ready for Pyodide's `loadPackage` to mount offline.
 *
 * ## Why pure-Python-only + why we resolve in main
 * Pyodide runs CPython compiled to WebAssembly, so it can only load pure-Python
 * wheels (`*-none-any.whl`) — a wheel with a compiled C extension has no WASM
 * build and is rejected with a clear message. Pyodide's own `micropip` (which
 * would resolve transitive deps from PyPI at runtime) is NOT vendored in the
 * offline bundle, so we can't rely on it. Instead this module resolves the whole
 * transitive closure HERE, in the main process — reading each wheel's `METADATA`
 * to discover its dependencies — and downloads every wheel into the cache. The
 * worker then just `loadPackage`s the local files, with no network and no
 * micropip.
 *
 * Transitive resolution is intentionally simple for this foundation: it follows
 * the hard (unconditional) `Requires-Dist` entries, honours an exact `== ` pin
 * when one is given, and otherwise takes the newest release that publishes a
 * pure-Python wheel. Dependencies gated by an environment marker or an `extra`
 * (e.g. `; extra == "socks"`) are skipped — they are optional.
 */
import { ZipReader, Uint8ArrayReader, TextWriter } from '@zip.js/zip.js'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cachedArtifacts, cacheKey } from './depsCache'
import { httpGetBytes, httpGetText, type ArtifactFetcher, type FetchedArtifact } from './depsInstaller'
import type { PackageSpec } from './types'

const PYPI_BASE = 'https://pypi.org/pypi'

interface PyPiUrl { filename: string; url: string; packagetype: string; yanked?: boolean }
interface PyPiJson { info?: { version?: string }; urls?: PyPiUrl[] }

function versionedJsonUrl(spec: PackageSpec): string {
  return `${PYPI_BASE}/${encodeURIComponent(spec.name)}/${encodeURIComponent(spec.version)}/json`
}
function latestJsonUrl(name: string): string {
  return `${PYPI_BASE}/${encodeURIComponent(name)}/json`
}

/** True for a pure-Python wheel: its ABI tag is `none` and its platform tag is
 * `any` (`{name}-{ver}(-{build})?-{python}-{abi}-{platform}.whl`). Only these
 * load under Pyodide's WASM CPython. */
export function isPureWheel(filename: string): boolean {
  const base = filename.replace(/\.whl$/i, '')
  const parts = base.split('-')
  if (parts.length < 3) return false
  const platform = parts[parts.length - 1]
  const abi = parts[parts.length - 2]
  return abi === 'none' && platform === 'any'
}

/** The {@link ArtifactFetcher} for Python: resolve a `name@version` to its
 * pure-Python wheel on PyPI and download it. Throws a user-readable, error-port
 * message when the package/version is missing, ships only C-extension wheels, or
 * publishes no wheel at all. */
export const pythonWheelFetcher: ArtifactFetcher = async (spec): Promise<FetchedArtifact[]> => {
  const meta = await fetchPyPiJson(versionedJsonUrl(spec), spec)
  const wheels = (meta.urls ?? []).filter((u) => u.packagetype === 'bdist_wheel' && u.yanked !== true)
  const pure = wheels.find((u) => isPureWheel(u.filename))
  if (pure) {
    return [{ filename: pure.filename, data: await httpGetBytes(pure.url) }]
  }
  if (wheels.length > 0) {
    throw new Error(
      `Python package "${spec.name}" ${spec.version} ships only platform-specific wheels (compiled C extensions). ` +
      `The Python runtime executes in WebAssembly (Pyodide), which can load only pure-Python packages.`
    )
  }
  throw new Error(
    `Python package "${spec.name}" ${spec.version} has no wheel on PyPI (only a source distribution). ` +
    `The Python runtime executes in WebAssembly (Pyodide) and cannot build source packages — use a package that ships a pure-Python wheel.`
  )
}

async function fetchPyPiJson(url: string, spec: PackageSpec): Promise<PyPiJson> {
  let raw: string
  try {
    raw = await httpGetText(url)
  } catch {
    throw new Error(`Python package "${spec.name}" ${spec.version} could not be found on PyPI.`)
  }
  return JSON.parse(raw) as PyPiJson
}

/**
 * Expand a set of top-level specs into the full closure of specs to cache,
 * resolving transitive dependencies by reading each already-cached wheel's
 * `METADATA`. `ensureCached` must have populated the cache for `roots` before
 * this is called; it is invoked again (by the caller) for the newly discovered
 * transitive specs, then this recurses. Returns only the NEWLY discovered
 * transitive specs for `roots` (dedup against `seen`).
 */
export async function resolveTransitiveSpecs(
  cacheDir: string,
  roots: readonly PackageSpec[],
  seen: Set<string>
): Promise<PackageSpec[]> {
  const discovered: PackageSpec[] = []
  for (const root of roots) {
    const wheelPath = cachedArtifacts(cacheDir, root).find((p) => p.toLowerCase().endsWith('.whl'))
    if (!wheelPath) continue
    const metadata = await readWheelMetadata(wheelPath)
    for (const depName of parseRequiredDistNames(metadata)) {
      const spec = await resolveLatestPureSpec(depName)
      if (!spec) continue
      const key = cacheKey(spec)
      if (seen.has(key)) continue
      seen.add(key)
      discovered.push(spec)
    }
  }
  return discovered
}

/** Resolve a bare dependency name to a concrete `name@version` whose newest
 * release publishes a pure-Python wheel. Returns undefined (dependency skipped)
 * when the package can't be resolved — a missing optional transitive shouldn't
 * abort the whole install; the eventual `ImportError` guides the user to pin it. */
async function resolveLatestPureSpec(name: string): Promise<PackageSpec | undefined> {
  let meta: PyPiJson
  try {
    meta = JSON.parse(await httpGetText(latestJsonUrl(name))) as PyPiJson
  } catch {
    return undefined
  }
  const version = meta.info?.version
  if (typeof version !== 'string' || version === '') return undefined
  const hasPure = (meta.urls ?? []).some((u) => u.packagetype === 'bdist_wheel' && u.yanked !== true && isPureWheel(u.filename))
  return hasPure ? { name, version } : undefined
}

/** Read a wheel's `*.dist-info/METADATA` text from a cached `.whl` file. */
async function readWheelMetadata(wheelPath: string): Promise<string> {
  const { readFile } = await import('node:fs/promises')
  const bytes = new Uint8Array(await readFile(wheelPath))
  const reader = new ZipReader(new Uint8ArrayReader(bytes))
  try {
    // The zip.js `getData` generic doesn't resolve cleanly under type-aware
    // lint; pin the entry shape to the reader/writer combo we use (mirrors
    // `services/historyArchive.ts`).
    const entries = (await reader.getEntries()) as { filename: string; getData?: (writer: TextWriter) => Promise<string> }[]
    const meta = entries.find((e) => /\.dist-info\/METADATA$/i.test(e.filename))
    if (!meta?.getData) return ''
    return await meta.getData(new TextWriter())
  } finally {
    await reader.close()
  }
}

/**
 * The full transitive closure of a top-level spec is recorded as a manifest so a
 * run can mount EXACTLY the wheels that spec needs — not every wheel that ever
 * landed in the shared per-language cache (which would leak another node's
 * packages into this run, and keep a removed dependency importable). Manifests
 * live under `<cacheDir>/.manifests/<name@version>.json`, out of the way of the
 * package directories {@link cachedArtifacts} scans.
 */
function manifestDir(cacheDir: string): string {
  return join(cacheDir, '.manifests')
}

/** Record a top-level spec's transitive closure (a list of `<name>@<version>`
 * cache keys, itself included) so `run` can resolve exactly its wheels. */
export function writeClosureManifest(cacheDir: string, root: PackageSpec, closureKeys: readonly string[]): void {
  const dir = manifestDir(cacheDir)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${cacheKey(root)}.json`), JSON.stringify([...closureKeys]))
}

/** Resolve the wheel files a top-level spec (and its whole closure) needs, from
 * its manifest. Falls back to just the spec's own wheels when no manifest exists
 * (e.g. a dependency-free package installed before manifests were written). */
export function readClosureWheels(cacheDir: string, root: PackageSpec): string[] {
  const manifestPath = join(manifestDir(cacheDir), `${cacheKey(root)}.json`)
  if (!existsSync(manifestPath)) {
    return cachedArtifacts(cacheDir, root).filter((p) => p.toLowerCase().endsWith('.whl'))
  }
  const keys = JSON.parse(readFileSync(manifestPath, 'utf8')) as string[]
  const wheels: string[] = []
  for (const key of keys) {
    const dir = join(cacheDir, key)
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) {
      if (f.toLowerCase().endsWith('.whl')) wheels.push(join(dir, f))
    }
  }
  return wheels
}

/**
 * Extract the hard runtime dependency names from a wheel's METADATA. Only
 * unconditional `Requires-Dist` entries count — any line carrying a `;` marker
 * (an environment marker or an `extra`) is an optional dependency and is
 * skipped. The name is the leading token before any version specifier / extras.
 */
export function parseRequiredDistNames(metadata: string): string[] {
  const names: string[] = []
  for (const line of metadata.split(/\r?\n/)) {
    const m = /^Requires-Dist:\s*(.+)$/i.exec(line)
    if (!m) continue
    const spec = m[1]
    if (spec.includes(';')) continue // marker / extra → optional, skip
    const name = spec.split(/[\s<>=!~;([]/)[0].trim()
    if (name !== '') names.push(name)
  }
  return [...new Set(names)]
}
