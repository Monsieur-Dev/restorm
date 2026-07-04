/**
 * Ruby gem source resolution for the `code` node — the main-process half that
 * turns a user's pinned `name@version` into a set of cached, pure-Ruby source
 * trees ready for the ruby.wasm worker to `require` offline.
 *
 * ## Why pure-Ruby-only + why we extract in main
 * ruby.wasm has no toolchain to compile a C extension, so a gem that ships one
 * (declared via its gemspec `extensions` list) is rejected with a clear message.
 * There is no runtime `gem install` in WASM either — instead this module
 * downloads a gem's `.gem` archive (a plain tar containing `metadata.gz`, the
 * gzipped YAML gemspec, and `data.tar.gz`, the gzipped tar of the gem's actual
 * files), reads the gemspec to find `require_paths` + `extensions` +
 * dependencies, and extracts the Ruby source under those `require_paths` onto
 * disk — via `tar` (node-tar), the same vetted, path-traversal-guarded archive
 * library every code-node runtime with a tar-shaped registry format uses. The
 * worker then WASI-preopens the cache directory and `$LOAD_PATH.unshift`s each
 * extracted `require_paths` entry, so `require "gem_name"` resolves with no
 * network and no gem-install step at run time.
 *
 * Transitive resolution is intentionally simple for this foundation: it reads
 * each cached gem's unconditional runtime dependencies (`type: :runtime` —
 * `:development`/other types are ignored), resolves a bare name + RubyGems
 * requirement (`>=`, `~>`, …) to the newest non-prerelease `ruby`-platform
 * release satisfying it via the RubyGems API, and recurses. A dependency that
 * can't be resolved on the registry is skipped (mirrors the Python runtime's
 * leniency for an unresolvable transitive); one that resolves but ships only
 * native extensions fails the whole install with a clear, named error — the
 * user has no way to pin a transitive dependency to a different, pure release.
 */
import { gunzipSync } from 'node:zlib'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as tar from 'tar'
import { parse as parseYaml } from 'yaml'
import { cacheKey, cachedArtifacts, isCached, packageDir } from './depsCache'
import { httpGetBytes, httpGetText, type ArtifactFetcher, type FetchedArtifact } from './depsInstaller'
import type { PackageSpec } from './types'

const RUBYGEMS_BASE = 'https://rubygems.org'

function gemDownloadUrl(spec: PackageSpec): string {
  return `${RUBYGEMS_BASE}/downloads/${encodeURIComponent(spec.name)}-${encodeURIComponent(spec.version)}.gem`
}
function versionsUrl(name: string): string {
  return `${RUBYGEMS_BASE}/api/v1/versions/${encodeURIComponent(name)}.json`
}

/** One `op version` clause of a RubyGems requirement (e.g. `>= 1.0`, `~> 2.1`). */
export interface RubyRequirementClause { op: string; version: string }
interface RubyDependency { name: string; requirements: RubyRequirementClause[] }

/** The slice of `Gem::Specification` this module needs, read from a gem's
 * `metadata.gz`. */
export interface RubyGemspec {
  name: string
  version: string
  /** Directories (relative to the gem root) that go on `$LOAD_PATH`. Defaults
   * to `['lib']` when the gemspec omits it (default RubyGems convention). */
  requirePaths: string[]
  /** Native-extension build scripts (`extconf.rb`, …) — non-empty means this
   * gem cannot run under ruby.wasm. */
  extensions: string[]
  /** Unconditional (`type: :runtime`) dependencies only — dev/test deps are
   * never needed to `require` the gem. */
  runtimeDependencies: RubyDependency[]
}

interface RubyGemsVersion { number: string; platform: string; prerelease: boolean }

// ---------------------------------------------------------------------------
// Gemspec YAML — `Gem::Specification` is serialised with Ruby-specific tags
// (`!ruby/object:Gem::Version`, …) the `yaml` package can't resolve; it falls
// back to the tagged node's plain mapping/sequence/scalar shape instead of
// throwing, which is exactly the loose structure this parser expects.
// ---------------------------------------------------------------------------

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function parseRequirementClauses(req: unknown): RubyRequirementClause[] {
  const raw = req && typeof req === 'object' ? (req as { requirements?: unknown }).requirements : undefined
  if (!Array.isArray(raw)) return []
  const out: RubyRequirementClause[] = []
  for (const clause of raw) {
    if (!Array.isArray(clause) || clause.length < 2) continue
    const [op, verObj] = clause as [unknown, unknown]
    const version = verObj && typeof verObj === 'object' ? (verObj as { version?: unknown }).version : undefined
    if (typeof op === 'string' && typeof version === 'string') out.push({ op, version })
  }
  return out
}

/** Parse a gemspec's raw YAML (already gunzipped) into the fields this module
 * needs, tolerating the Ruby-tagged, loosely-typed shape `yaml` produces. */
/** Stringify a loosely-typed YAML scalar, never falling back to `String()`'s
 * `'[object Object]'` for a shape this parser didn't expect to see here. */
function toVersionString(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v) : ''
}

export function parseGemspecYaml(yamlText: string): RubyGemspec {
  // `logLevel: 'silent'` — every Ruby-tagged node triggers an "unresolved tag"
  // warning by default; that's expected here (see above), not worth the noise
  // on every install.
  const doc = parseYaml(yamlText, { logLevel: 'silent' }) as Record<string, unknown>
  const versionField = doc['version']
  const version = versionField && typeof versionField === 'object'
    ? toVersionString((versionField as { version?: unknown }).version)
    : toVersionString(versionField)
  const requirePaths = asStringArray(doc['require_paths'])
  const dependencies: RubyDependency[] = []
  for (const dep of Array.isArray(doc['dependencies']) ? doc['dependencies'] : []) {
    if (!dep || typeof dep !== 'object') continue
    const d = dep as Record<string, unknown>
    if (d['type'] !== ':runtime' || typeof d['name'] !== 'string') continue // dev/test deps aren't needed to require the gem
    dependencies.push({ name: d['name'], requirements: parseRequirementClauses(d['requirement']) })
  }
  return {
    name: typeof doc['name'] === 'string' ? doc['name'] : '',
    version,
    requirePaths: requirePaths.length > 0 ? requirePaths : ['lib'],
    extensions: asStringArray(doc['extensions']),
    runtimeDependencies: dependencies
  }
}

// ---------------------------------------------------------------------------
// RubyGems version comparison + requirement satisfaction — a greedy
// 'latest-satisfying' resolver, sufficient for this foundation (see module doc).
// ---------------------------------------------------------------------------

/** Compare two RubyGems-style dotted version numbers, numeric-segment aware
 * (`"1.10"` > `"1.9"`). A non-numeric segment (rare — a pre-release suffix)
 * falls back to a lexical compare. */
export function compareRubyVersions(a: string, b: string): number {
  const as = a.split('.')
  const bs = b.split('.')
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const x = as[i] ?? '0'
    const y = bs[i] ?? '0'
    const nx = Number(x)
    const ny = Number(y)
    if (Number.isFinite(nx) && Number.isFinite(ny)) {
      if (nx !== ny) return nx - ny
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}

/** True when `version` satisfies every clause (an implicit AND, as RubyGems
 * requirement arrays are). Supports the operators a gemspec dependency can
 * carry: `=`, `!=`, `>`, `>=`, `<`, `<=`, and the pessimistic `~>` (>= the
 * given version, < the next release that increments its second-to-last
 * segment — e.g. `~> 1.2.3` means `>= 1.2.3, < 1.3.0`). */
export function satisfiesRequirement(version: string, requirements: readonly RubyRequirementClause[]): boolean {
  return requirements.every(({ op, version: reqVersion }) => {
    const cmp = compareRubyVersions(version, reqVersion)
    switch (op) {
      case '=': return cmp === 0
      case '!=': return cmp !== 0
      case '>': return cmp > 0
      case '>=': return cmp >= 0
      case '<': return cmp < 0
      case '<=': return cmp <= 0
      case '~>': {
        if (cmp < 0) return false
        // The ceiling increments the SECOND-TO-LAST segment (dropping the
        // last one entirely), not the last: `~> 1.2.3` means `< 1.3.0`, not
        // `< 1.2.4`. A single-segment requirement (`~> 1`) has no
        // second-to-last segment, so it falls back to incrementing itself.
        const segs = reqVersion.split('.')
        const ceilingSegs = segs.length > 1 ? segs.slice(0, -1) : segs.slice()
        const lastIdx = ceilingSegs.length - 1
        ceilingSegs[lastIdx] = String(Number(ceilingSegs[lastIdx] ?? '0') + 1)
        return compareRubyVersions(version, ceilingSegs.join('.')) < 0
      }
      default: return true // an operator we don't know shouldn't block resolution
    }
  })
}

/** Resolve a bare dependency name + requirement to the newest non-prerelease,
 * `ruby`-platform (portable, not JRuby/Windows-specific) release satisfying it.
 * Returns undefined when the name/registry lookup fails or nothing satisfies —
 * the caller skips it, mirroring the Python runtime's leniency for an
 * unresolvable transitive dependency. */
export async function resolveSatisfyingVersion(name: string, requirements: readonly RubyRequirementClause[]): Promise<PackageSpec | undefined> {
  let versions: RubyGemsVersion[]
  try {
    versions = JSON.parse(await httpGetText(versionsUrl(name))) as RubyGemsVersion[]
  } catch {
    return undefined
  }
  const best = versions
    .filter((v) => v.platform === 'ruby' && !v.prerelease && satisfiesRequirement(v.number, requirements))
    .sort((a, b) => compareRubyVersions(b.number, a.number))[0]
  return best ? { name, version: best.number } : undefined
}

/**
 * Expand a set of already-cached specs into the full closure of specs to
 * cache, by reading each's LOCAL gemspec (no network — the `.gem` is already
 * downloaded) for its runtime dependency names, then resolving each bare name
 * against the registry. Returns only the NEWLY discovered specs (deduped
 * against `seen`, which the caller re-invokes this with for the next frontier —
 * cycle-safe: a dependency cycle can never re-add a key already in `seen`).
 */
export async function resolveTransitiveSpecs(cacheDir: string, roots: readonly PackageSpec[], seen: Set<string>): Promise<PackageSpec[]> {
  const discovered: PackageSpec[] = []
  for (const root of roots) {
    // ensureExtracted is idempotent (a no-op re-verification once already
    // extracted), so re-deriving the gemspec here costs one small, local
    // outer-tar read — no network.
    const { runtimeDependencies } = ensureExtracted(cacheDir, root)
    for (const dep of runtimeDependencies) {
      const resolved = await resolveSatisfyingVersion(dep.name, dep.requirements)
      if (!resolved) continue
      const key = cacheKey(resolved)
      if (seen.has(key)) continue
      seen.add(key)
      discovered.push(resolved)
    }
  }
  return discovered
}

/** The {@link ArtifactFetcher} for Ruby: download a pinned gem's raw `.gem`
 * archive. The native-extension check happens in {@link ensureExtracted}
 * (which needs `tar.x` on a real cached file anyway); this stays a plain
 * download. Throws a user-readable, error-port-bound message when the
 * package/version can't be found. */
export const rubyGemFetcher: ArtifactFetcher = async (spec): Promise<FetchedArtifact[]> => {
  let data: Uint8Array
  try {
    data = await httpGetBytes(gemDownloadUrl(spec))
  } catch {
    throw new Error(`Ruby gem "${spec.name}" ${spec.version} could not be found on RubyGems.`)
  }
  return [{ filename: `${spec.name}-${spec.version}.gem`, data }]
}

/**
 * Extract a cached gem's pure-Ruby source files (every `.rb` file under its
 * `require_paths`) onto disk, next to the cached `.gem` archive, so the
 * ruby.wasm worker can WASI-preopen the package directory and `require` them
 * directly. A `.gem` is a tar-of-tars: the outer archive is unpacked into a
 * scratch temp dir (cleaned up before returning) to read `metadata.gz` (the
 * gzipped gemspec YAML) and reject a native-extension gem BEFORE ever
 * extracting its source; `data.tar.gz` — the gem's actual files — is then
 * unpacked straight into the package's cache directory, filtered to just the
 * `.rb` files under `require_paths` (via `tar`'s own path-traversal-guarded
 * extractor). Idempotent — a no-op re-verification once the first
 * `require_paths` entry already exists on disk. Returns the gemspec (the
 * caller needs `requirePaths` + `runtimeDependencies`).
 */
export function ensureExtracted(cacheDir: string, spec: PackageSpec): RubyGemspec {
  const gemPath = cachedArtifacts(cacheDir, spec).find((p) => p.toLowerCase().endsWith('.gem'))
  if (!gemPath) throw new Error(`code deps: Ruby gem "${spec.name}@${spec.version}" is not cached`)

  const scratchDir = mkdtempSync(join(tmpdir(), 'restorm-ruby-gem-'))
  try {
    tar.x({ file: gemPath, cwd: scratchDir, sync: true })
    const gemspec = parseGemspecYaml(gunzipSync(readFileSync(join(scratchDir, 'metadata.gz'))).toString('utf8'))
    if (gemspec.extensions.length > 0) {
      throw new Error(
        `Ruby gem "${spec.name}" ${spec.version} requires native C extensions (${gemspec.extensions.join(', ')}) ` +
        `and is not supported in the WASM runtime (ruby.wasm executes pure-Ruby source only).`
      )
    }
    const pkgDir = packageDir(cacheDir, spec)
    const alreadyExtracted = gemspec.requirePaths.some((rp) => existsSync(join(pkgDir, rp)))
    if (!alreadyExtracted) {
      mkdirSync(pkgDir, { recursive: true })
      tar.x({
        file: join(scratchDir, 'data.tar.gz'),
        cwd: pkgDir,
        sync: true,
        filter: (entryPath) =>
          entryPath.toLowerCase().endsWith('.rb') &&
          gemspec.requirePaths.some((rp) => entryPath === rp || entryPath.startsWith(`${rp}/`))
      })
    }
    return gemspec
  } finally {
    rmSync(scratchDir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// Closure manifest — records, per pinned top-level spec, exactly which gems
// (and their require_paths) its closure resolved to, so a run mounts exactly
// those gems (not every gem ever cached for the language) and a fully-cached
// re-run can skip resolution/extraction entirely (see {@link isClosureReady}).
// ---------------------------------------------------------------------------

/** One closure member: a cache key (`name@version`) + its `require_paths`. */
export interface RubyClosureEntry { key: string; requirePaths: string[] }

function manifestDir(cacheDir: string): string {
  return join(cacheDir, '.manifests')
}
function manifestPath(cacheDir: string, root: PackageSpec): string {
  return join(manifestDir(cacheDir), `${cacheKey(root)}.json`)
}
function splitKey(key: string): PackageSpec {
  const at = key.lastIndexOf('@')
  return { name: key.slice(0, at), version: key.slice(at + 1) }
}

/** Record a top-level spec's full transitive closure (itself included). */
export function writeClosureManifest(cacheDir: string, root: PackageSpec, entries: readonly RubyClosureEntry[]): void {
  mkdirSync(manifestDir(cacheDir), { recursive: true })
  writeFileSync(manifestPath(cacheDir, root), JSON.stringify(entries))
}

function readClosureManifest(cacheDir: string, root: PackageSpec): RubyClosureEntry[] | undefined {
  const p = manifestPath(cacheDir, root)
  if (!existsSync(p)) return undefined
  return JSON.parse(readFileSync(p, 'utf8')) as RubyClosureEntry[]
}

/** True when every member of a spec's recorded closure is still cached AND
 * extracted on disk — a fast, network-free confirmation that a previous
 * install fully provisioned it, so a re-run can skip resolution/download/
 * extraction entirely rather than merely re-checking each artifact. */
export function isClosureReady(cacheDir: string, root: PackageSpec): boolean {
  const entries = readClosureManifest(cacheDir, root)
  if (!entries) return false
  return entries.every(({ key, requirePaths }) => {
    const spec = splitKey(key)
    return isCached(cacheDir, spec) && requirePaths.every((rp) => existsSync(join(packageDir(cacheDir, spec), rp)))
  })
}

/** A resolved closure member ready to mount: which package, and its
 * `require_paths` (relative to the package's cache directory). */
export interface RubyClosureGem { name: string; version: string; requirePaths: string[] }

/** The exact set of gems a top-level spec's closure needs, from its manifest.
 * Falls back to just the spec's own `require_paths` (read from its cached
 * gemspec) when no manifest exists yet. */
export function readClosureGems(cacheDir: string, root: PackageSpec): RubyClosureGem[] {
  const entries = readClosureManifest(cacheDir, root)
  if (!entries) {
    if (!isCached(cacheDir, root)) return []
    const gemspec = ensureExtracted(cacheDir, root)
    return [{ name: root.name, version: root.version, requirePaths: gemspec.requirePaths }]
  }
  return entries.map(({ key, requirePaths }) => { const spec = splitKey(key); return { ...spec, requirePaths } })
}
