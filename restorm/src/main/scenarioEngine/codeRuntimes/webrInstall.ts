/**
 * R (WebR) dependency resolution + on-disk extraction for the `code` node —
 * the main-process half that turns a user's pinned `name@version` into a
 * WebR CRAN-WASM binary cached on disk AND extracted to real files, ready for
 * {@link ./rRuntime}'s `mountPackages` to `FS.mount('NODEFS', …)` straight
 * into WebR's virtual filesystem (the R equivalent of Pyodide's "hand
 * `loadPackage` the real absolute paths" trick — see `./pythonRuntime`).
 *
 * ## The registry
 * WebR publishes a CRAN-like binary repository at `repo.r-wasm.org`, ONE
 * fixed R-version-pinned snapshot at a time. Unlike PyPI, a single `PACKAGES`
 * index (a Debian-control-file, one paragraph per package) at
 * `<repo>/bin/emscripten/contrib/<Rmajor.minor>/PACKAGES` lists EVERY
 * available package with its exact version, its `.tgz` filename, and its hard
 * `Depends`/`Imports` names — this mirrors what WebR's own R-side
 * `webr::install()` reads (see `install.R` in r-wasm/webr), resolved here in
 * the main process instead of inside the WASM R interpreter so the fetch goes
 * through the shared SSRF-guarded installer. Because the whole index is ONE
 * fetch, resolving the transitive closure needs no extra network round trip
 * per dependency (unlike Python, which must query PyPI per package) — a
 * base-R package (`methods`, `stats`, `utils`, …) simply isn't in the index
 * and is skipped, since it already ships with the R distribution itself.
 *
 * ## Why we extract instead of mounting the raw archive
 * The repo's `.tgz` is a plain gzip'd POSIX tar whose only top-level entry is
 * the package's install directory (e.g. `jsonlite/DESCRIPTION`,
 * `jsonlite/R/…`). WebR's own v2.0 "VFS image" mount format is a
 * special-cased archive layout that not every published package carries —
 * `install.R` itself tries that mount first and falls back to a plain
 * `untar()` when it fails — so mounting reliably means extracting to real
 * files once, then handing WebR's `FS.mount('NODEFS', …)` the extracted
 * directory.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { x as untar } from 'tar'
import { httpGetBytes, httpGetText, type ArtifactFetcher, type FetchedArtifact } from './depsInstaller'
import { cachedArtifacts, cacheKey, packageDir } from './depsCache'
import type { PackageSpec } from './types'

/** WebR's default binary package repository — the same host `webr::install()`
 * uses (`getOption("webr_pkg_repos")`). */
const WEBR_REPO = 'https://repo.r-wasm.org'

/** The `<Rmajor.minor>` contrib path segment, derived from the running WebR's
 * bundled R version (e.g. `"4.6.0"` → `"4.6"`) — mirrors `install.R`'s own
 * `gsub("\\.[^.]+$", "", ver)`. `getRversion()` always yields at least a
 * `major.minor.patch` triple, so stripping the last segment is safe. */
export function contribVersion(versionR: string): string {
  return versionR.replace(/\.[^.]+$/, '')
}

function contribUrl(versionR: string): string {
  return `${WEBR_REPO}/bin/emscripten/contrib/${contribVersion(versionR)}`
}

/** One package's entry in the `PACKAGES` index. */
export interface RPackageEntry {
  version: string
  /** The `.tgz` filename, relative to the contrib URL. */
  file: string
  /** Hard `Depends`/`Imports` package names — version constraints
   * (`(>= x.y)`) and the base-R pseudo-dependency `R` are stripped.
   * `Suggests`/`Enhances` are optional and intentionally not read, matching
   * webR's own resolver (`tools::package_dependencies(..., c("Depends", "Imports"))`). */
  depends: string[]
}

/** Parse a DCF `Depends`/`Imports` field value into bare package names. */
function parseDependsField(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim().replace(/\s*\(.*\)\s*$/, ''))
    .filter((name) => name !== '' && name !== 'R')
}

/**
 * Parse the whole `PACKAGES` index text into a lookup by package name. DCF
 * paragraphs are separated by a blank line; a field value may continue on the
 * following line(s) indented with whitespace (standard DCF folding).
 */
export function parsePackagesIndex(text: string): Map<string, RPackageEntry> {
  const index = new Map<string, RPackageEntry>()
  for (const block of text.split(/\r?\n\r?\n+/)) {
    const fields = new Map<string, string>()
    let lastKey: string | undefined
    for (const line of block.split(/\r?\n/)) {
      if (line === '') continue
      if (/^\s/.test(line) && lastKey !== undefined) {
        fields.set(lastKey, `${fields.get(lastKey)} ${line.trim()}`)
        continue
      }
      const m = /^([\w.-]+):\s*(.*)$/.exec(line)
      if (!m) continue
      fields.set(m[1], m[2])
      lastKey = m[1]
    }
    const name = fields.get('Package')
    const version = fields.get('Version')
    const file = fields.get('File')
    if (name === undefined || version === undefined || file === undefined) continue
    const depends = [...parseDependsField(fields.get('Depends') ?? ''), ...parseDependsField(fields.get('Imports') ?? '')]
    index.set(name, { version, file, depends: [...new Set(depends)] })
  }
  return index
}

/**
 * The offline mirror's own `PACKAGES` index, when `RESTORM_CODE_DEPS_OFFLINE_DIR`
 * points at one and it provides `r/PACKAGES` — lets an air-gapped install (and
 * the e2e's deterministic, zero-registry fixture) resolve names/versions/deps
 * with no network at all. This is the one extra registry call R needs that
 * Python doesn't (a bulk index vs. a per-package PyPI lookup), so it gets its
 * own offline escape hatch alongside {@link ./depsInstaller}'s existing
 * per-artifact mirror copy (same env var, same `<mirror>/<lang>/…` layout).
 */
function offlinePackagesIndexPath(): string | undefined {
  const mirror = process.env['RESTORM_CODE_DEPS_OFFLINE_DIR']
  if (!mirror) return undefined
  const path = join(mirror, 'r', 'PACKAGES')
  return existsSync(path) ? path : undefined
}

/** Fetch + parse the `PACKAGES` index for the WebR bundle's R version. One
 * fetch serves the whole install — top-level packages AND every transitive
 * level — unlike PyPI, which needs a call per package. */
export async function fetchPackagesIndex(versionR: string): Promise<{ index: Map<string, RPackageEntry>; contribUrl: string }> {
  const url = contribUrl(versionR)
  const offlineIndex = offlinePackagesIndexPath()
  const text = offlineIndex ? readFileSync(offlineIndex, 'utf8') : await httpGetText(`${url}/PACKAGES`)
  return { index: parsePackagesIndex(text), contribUrl: url }
}

/**
 * The {@link ArtifactFetcher} for R: resolve a `name@version` against the
 * already-fetched `PACKAGES` index and download its `.tgz`. Rejects with the
 * exact, user-readable message the executor routes to the node's `error`
 * port when the package isn't published at all, or not at the pinned
 * version (the WebR repo publishes exactly one version per package, so a
 * pin mismatch is just as unavailable as a missing name).
 */
export function makeRWasmFetcher(index: Map<string, RPackageEntry>, resolvedContribUrl: string): ArtifactFetcher {
  return async (spec: PackageSpec): Promise<FetchedArtifact[]> => {
    const entry = index.get(spec.name)
    if (entry?.version !== spec.version) {
      throw new Error(`R package ${spec.name} is not available as a WebR WASM package`)
    }
    return [{ filename: entry.file, data: await httpGetBytes(`${resolvedContribUrl}/${entry.file}`) }]
  }
}

/**
 * Expand a frontier of specs into their NEWLY discovered transitive
 * dependencies, resolved directly from the already-fetched index — no extra
 * network call, since the whole registry is one DCF file. A dependency name
 * absent from the index is a base-R package already available in WebR (e.g.
 * `methods`, `stats`) and is silently skipped, not an error.
 */
export function resolveTransitiveSpecs(index: Map<string, RPackageEntry>, roots: readonly PackageSpec[], seen: Set<string>): PackageSpec[] {
  const discovered: PackageSpec[] = []
  for (const root of roots) {
    const entry = index.get(root.name)
    if (!entry) continue
    for (const depName of entry.depends) {
      const depEntry = index.get(depName)
      if (!depEntry) continue // base-R package, already available — nothing to fetch
      const spec: PackageSpec = { name: depName, version: depEntry.version }
      const key = cacheKey(spec)
      if (seen.has(key)) continue
      seen.add(key)
      discovered.push(spec)
    }
  }
  return discovered
}

/** The extracted, real-files directory for a cached package — a sibling of
 * its raw `.tgz` artifact, populated on first use by {@link ensureExtracted}.
 * Its only meaningful child is `<name>/` (the tarball's own top-level entry),
 * exactly the shape `FS.mount('NODEFS', …)` needs for `library(<name>)` to
 * resolve. */
function extractedDir(cacheDir: string, spec: PackageSpec): string {
  return join(packageDir(cacheDir, spec), 'extracted')
}

/**
 * Extract a cached package's `.tgz` into its `extracted/` directory, unless
 * already done. Idempotent, and safe against a malicious archive: `tar.x`
 * with `preservePaths: false` (explicit here, though it is also the default)
 * silently drops any entry that would escape `cwd` via `..` or an absolute
 * path, so a tampered/compromised registry response can't write outside the
 * cache.
 */
export function ensureExtracted(cacheDir: string, spec: PackageSpec): string {
  const dir = extractedDir(cacheDir, spec)
  if (existsSync(dir)) return dir
  const tgz = cachedArtifacts(cacheDir, spec).find((p) => p.toLowerCase().endsWith('.tgz'))
  if (!tgz) throw new Error(`code deps: no cached artifact to extract for R package ${spec.name}@${spec.version}`)
  mkdirSync(dir, { recursive: true })
  untar({ file: tgz, cwd: dir, sync: true, preservePaths: false })
  return dir
}

/**
 * Every package currently cached under `cacheDir`, derived from its
 * `<name>@<version>` directory names (the `depsCache` convention) — the
 * whole-cache view {@link ./rRuntime}'s `mountPackages` mounts. Mirrors
 * Python's `allCachedWheels`, except R has no per-run closure manifest: WebR
 * is one persistent singleton interpreter (unlike Pyodide's fresh
 * worker-per-run), so there is no worker boundary to scope mounts to, and
 * every run already serialises through the same `queue` — exposing the whole
 * cache to `library()` is a deliberate, documented simplification.
 */
export function allCachedSpecs(cacheDir: string): PackageSpec[] {
  if (!existsSync(cacheDir)) return []
  const specs: PackageSpec[] = []
  for (const entry of readdirSync(cacheDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const at = entry.name.indexOf('@')
    if (at <= 0) continue
    specs.push({ name: entry.name.slice(0, at), version: entry.name.slice(at + 1) })
  }
  return specs
}
