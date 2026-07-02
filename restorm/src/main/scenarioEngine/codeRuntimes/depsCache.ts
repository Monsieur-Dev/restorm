/**
 * On-disk cache for the `code` node's external dependencies. Artifacts (Python
 * wheels today; npm bundles / gems / … as later runtimes land) live under
 *
 *   `<os-temp>/restorm-code-deps/<lang>/<name>@<version>/`
 *
 * in the OS temp directory (NOT userData) so the cache is auto-reclaimed by the
 * OS and can't grow userData unbounded. The OS may clear temp between sessions —
 * that just triggers a re-download on next use, which is fine for a cache.
 *
 * keyed by the PIN-EXACT `name@version` the user pinned, so two nodes asking for
 * the same package share one download and any re-run — even across app restarts
 * — is a pure cache hit with no network activity. The cache is content-addressed
 * only by that key: a given `name@version` maps to exactly one immutable set of
 * files, never overwritten in place.
 *
 * This module is pure filesystem plumbing — no network. {@link ../depsInstaller}
 * fills the cache; the runtimes read from it.
 */
import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PackageSpec } from './types'

/** The root the whole feature caches under (`<os-temp>/restorm-code-deps`). */
export function codeDepsRoot(): string {
  return join(app.getPath('temp'), 'restorm-code-deps')
}

/** The per-language cache root (`<os-temp>/restorm-code-deps/<lang>`), passed to
 * a runtime's `installPackages` / `mountPackages` as its `cacheDir`. */
export function codeDepsCacheDir(lang: string): string {
  return join(codeDepsRoot(), sanitizeSegment(lang))
}

/** The directory a single package's artifacts live in (`<cacheDir>/<name>@<version>`). */
export function packageDir(cacheDir: string, spec: PackageSpec): string {
  return join(cacheDir, cacheKey(spec))
}

/** The `<name>@<version>` cache key — the on-disk directory name for a package. */
export function cacheKey(spec: PackageSpec): string {
  return `${sanitizeSegment(spec.name)}@${sanitizeSegment(spec.version)}`
}

/**
 * True when a package is already fully cached: its directory exists and holds at
 * least one artifact file. A partial download never leaves an artifact behind
 * (the installer writes atomically after a complete fetch), so "has an artifact"
 * is a safe completeness signal — a cache hit here means the installer skips ALL
 * network activity for this package.
 */
export function isCached(cacheDir: string, spec: PackageSpec): boolean {
  return cachedArtifacts(cacheDir, spec).length > 0
}

/** Absolute paths of every artifact file cached for a package (empty if none). */
export function cachedArtifacts(cacheDir: string, spec: PackageSpec): string[] {
  const dir = packageDir(cacheDir, spec)
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(dir, e.name))
}

/**
 * A named sub-directory inside a package's cache dir, sanitised like every
 * other path segment. {@link isCached} / {@link cachedArtifacts} only scan the
 * package dir itself (not its sub-directories), so a runtime that keeps a raw
 * fetched artifact separate from a derived one it caches at the package root
 * (e.g. the npm runtime's fetched tarball vs. its esbuild `bundle.js`) can tuck
 * the raw artifact away here without it counting as a "ready" cache-hit signal
 * on its own — only the derived, package-root artifact does.
 */
export function packageSubDir(cacheDir: string, spec: PackageSpec, sub: string): string {
  return join(packageDir(cacheDir, spec), sanitizeSegment(sub))
}

/**
 * Write one file into an already-resolved directory (creating it as needed),
 * sanitising the filename segment. The primitive behind {@link writeArtifact};
 * also used directly by a runtime writing into a {@link packageSubDir}.
 */
export function writeFileAt(dir: string, filename: string, data: Uint8Array): string {
  mkdirSync(dir, { recursive: true })
  const dest = join(dir, sanitizeSegment(filename))
  writeFileSync(dest, data)
  return dest
}

/**
 * Write one artifact into a package's cache directory and return its absolute
 * path. The caller only writes AFTER a complete, validated download, so the
 * presence of the file is the atomic "cached" marker {@link isCached} relies on.
 */
export function writeArtifact(cacheDir: string, spec: PackageSpec, filename: string, data: Uint8Array): string {
  return writeFileAt(packageDir(cacheDir, spec), filename, data)
}

/** Reject path-traversal / separator characters in a name, version or filename
 * before it becomes a directory segment — the values come from user config and
 * a package registry, so they are untrusted for filesystem use. */
function sanitizeSegment(value: string): string {
  // Reject path separators, the `.`/`..` traversal names, AND the characters a
  // filesystem treats specially — `:` (Windows drive / NTFS alternate-data-stream)
  // and NUL — so a name/version/filename from user config or a registry can never
  // escape or corrupt the cache directory. (PEP 440 versions + PyPI names never
  // contain these; later runtimes sanitise their own ecosystem's edge cases.)
  if (value === '' || value === '.' || value === '..' || /[/\\:\0]/.test(value)) {
    throw new Error(`code deps: unsafe cache path segment '${value}'`)
  }
  return value
}
