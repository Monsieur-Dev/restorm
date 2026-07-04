/**
 * npm dependency resolution + esbuild bundling for the `code` node's JS/TS
 * runtime (QuickJS) — the main-process half that turns a user's pinned
 * `name@version` into a cached, pure-JS esbuild bundle ready to inject into the
 * sandbox (see `../codeSandbox`'s "user-pinned npm packages" step and
 * `./javascriptRuntime`).
 *
 * ## Why we cache the BUNDLE, not just the tarball
 * The curated standard library (`../codeSandbox`'s `SANDBOX_LIBS`) is bundled
 * ONCE with esbuild into a browser-platform IIFE before it ever reaches QuickJS
 * — a user-pinned package needs the exact same treatment: esbuild resolves the
 * package's own relative requires and substitutes the SAME `NODE_BUILTIN_SHIMS`
 * a couple of the curated libs already rely on (reused from `../codeSandbox`,
 * not a second drifting copy). The derived `bundle.js` — not the raw tarball —
 * is what {@link ensurePackagesCached}'s generic `isCached` check scans for at
 * the package root, so a cache hit skips BOTH the network fetch AND the esbuild
 * pass with no extra bookkeeping (see {@link npmBundleFetcher}).
 *
 * ## Scope: no transitive npm dependencies
 * Unlike the Python runtime (which resolves a wheel's whole transitive closure
 * from PyPI metadata), this bundles ONLY the pinned package's own files. A
 * `require('some-other-package')` inside the pinned package's source that isn't
 * a relative import or a shimmed Node built-in fails to resolve at BUNDLE time
 * — a clear esbuild error naming the missing specifier, not a silent runtime
 * crash — because the package is extracted into its OWN scratch directory with
 * no `node_modules` of its own. Self-contained pure-JS utilities (the common
 * case for a "pin one small helper" use) bundle cleanly; a package that itself
 * depends on another npm package needs that package ALSO pinned and
 * `require()`'d directly by the user's own code.
 *
 * ## Extraction uses `tar` (node-tar), not a hand-rolled reader
 * A npm tarball is untrusted input (its paths flow straight from the registry),
 * so extraction goes through `node-tar` — the library npm itself uses — for its
 * vetted `..`/absolute-path traversal sanitisation, rather than a bespoke
 * ustar/PAX parser. Every code-node runtime that unpacks an untrusted archive
 * (npm here; gems/nupkg for the sibling runtimes) uses the same library.
 *
 * ## Scoped packages (`@scope/name`) are out of scope
 * `depsCache`'s `sanitizeSegment` already rejects any `/` in a cache-key
 * segment, so a scoped package name fails with a clear (if generic) cache-path
 * error before it ever reaches this module. Not required by this ticket.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { build as esbuild } from 'esbuild'
import { extract as tarExtract } from 'tar'
import { npmPackageGlobalName } from '../../../shared/codeNodePackages'
import { packageDir, packageSubDir, writeFileAt } from './depsCache'
import { httpGetBytes, httpGetText, type ArtifactFetcher, type FetchedArtifact } from './depsInstaller'
import type { PackageSpec } from './types'

const NPM_REGISTRY = 'https://registry.npmjs.org'

// The registry manifest is only used for the tarball URL — once downloaded, the
// entry point is resolved from the tarball's OWN package.json (the source of
// truth `resolveEntryField` reads), not the registry's copy of those fields.
interface NpmVersionManifest {
  dist?: { tarball?: string }
}

function versionManifestUrl(spec: PackageSpec): string {
  return `${NPM_REGISTRY}/${encodeURIComponent(spec.name)}/${encodeURIComponent(spec.version)}`
}

async function fetchNpmManifest(spec: PackageSpec): Promise<NpmVersionManifest> {
  let raw: string
  try {
    raw = await httpGetText(versionManifestUrl(spec))
  } catch {
    throw new Error(`npm package "${spec.name}" ${spec.version} could not be found on the npm registry.`)
  }
  return JSON.parse(raw) as NpmVersionManifest
}

/** Resolve the package's entry FILE (relative to the tarball's `package/`
 * root): the `main` field, falling back to the root of a modern `exports` map
 * (`.` → string, or a `require`/`default`/`import` condition), then finally
 * `index.js` — the same fallback order Node itself uses when `main` is absent. */
function resolveEntryField(pkgJson: Record<string, unknown>): string {
  if (typeof pkgJson['main'] === 'string' && pkgJson['main'].trim() !== '') return pkgJson['main']
  const exp = pkgJson['exports']
  const dot = exp && typeof exp === 'object' ? (exp as Record<string, unknown>)['.'] ?? exp : exp
  if (typeof dot === 'string') return dot
  if (dot && typeof dot === 'object') {
    const cond = dot as Record<string, unknown>
    const val = cond['require'] ?? cond['default'] ?? cond['import']
    if (typeof val === 'string') return val
  }
  return 'index.js'
}

/**
 * Extract a gzipped npm tarball into a fresh scratch directory using `node-tar`
 * (its `..`/absolute-path traversal sanitisation is exactly why we don't parse
 * tar ourselves — see the module doc). Caller is responsible for removing the
 * returned directory once bundling is done (success or failure).
 */
async function extractTarball(tarballBytes: Uint8Array): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'restorm-npm-extract-'))
  await new Promise<void>((resolve, reject) => {
    Readable.from(Buffer.from(tarballBytes))
      .pipe(tarExtract({ cwd: dir }))
      .on('finish', resolve)
      .on('error', reject)
  })
  return dir
}

/** The tarball's top-level directory (near-universally `package`, per `npm
 * pack`'s convention — but resolved from the extracted tree itself rather than
 * assumed, in case a registry ever ships something else). */
function findExtractedRoot(dir: string): string {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && existsSync(join(dir, entry.name, 'package.json'))) return join(dir, entry.name)
  }
  return join(dir, 'package')
}

/** Bundle one package's already-extracted files (a real directory on disk —
 * see {@link extractTarball}) into a browser-platform IIFE that assigns its
 * `module.exports` to `__pkgExports` — mirrors how the curated stdlib prelude
 * is bundled, reusing the SAME `NODE_BUILTIN_SHIMS` plugin so a package that
 * needs `events`/`timers` gets the identical shim. esbuild resolves the
 * package's own relative `require()`s straight off the extracted directory, no
 * in-memory resolver plugin needed. Rejects with a message naming the
 * unresolvable specifier on a real esbuild failure (a transitive npm
 * dependency, a native addon, a dynamic `require` esbuild can't follow
 * statically, …). */
async function bundlePackage(spec: PackageSpec, entryPath: string): Promise<string> {
  // Reuse the exact shim set/plugin the curated stdlib prelude bundles with —
  // dynamic import keeps codeSandbox's heavy QuickJS import out of the
  // install-time path (this only needs its esbuild plugin + shim table).
  const { nodeBuiltinShimPlugin } = await import('../codeSandbox')
  try {
    const result = await esbuild({
      entryPoints: [entryPath],
      bundle: true,
      format: 'iife',
      globalName: '__pkgExports',
      platform: 'browser',
      target: 'es2020',
      write: false,
      legalComments: 'none',
      plugins: [nodeBuiltinShimPlugin],
      logLevel: 'silent'
    })
    return result.outputFiles[0].text
  } catch (err) {
    const messages = (err as { errors?: { text: string }[] } | undefined)?.errors?.map((e) => e.text).join('; ')
    throw new Error(
      `npm package "${spec.name}" ${spec.version} could not be bundled` +
      (messages ? `: ${messages}` : ` (${err instanceof Error ? err.message : String(err)})`) +
      '. The JS/TS runtime bundles only the pinned package\'s own pure-JS files — a native addon, ' +
      'a Node built-in outside the sandbox\'s shim set, or a dependency on another npm package ' +
      '(not itself pinned) cannot be resolved.'
    )
  }
}

/** The {@link ArtifactFetcher} for npm: resolve `name@version` on the registry,
 * download the tarball, persist it under a `tarball/` sub-directory for
 * provenance (kept OUT of the package root so it never counts as a cache-hit
 * signal on its own — see the module doc), extract (via `node-tar`, into a
 * scratch dir always cleaned up in `finally`) + esbuild-bundle its entry point,
 * and return the bundle as the artifact {@link ensurePackagesCached} writes
 * flatly at the package root (`bundle.js`) — THAT presence is what makes a
 * re-run skip both the network fetch and the esbuild pass. */
export const npmBundleFetcher: ArtifactFetcher = async (spec, cacheDir): Promise<FetchedArtifact[]> => {
  const manifest = await fetchNpmManifest(spec)
  const tarballUrl = manifest.dist?.tarball
  if (!tarballUrl) throw new Error(`npm package "${spec.name}" ${spec.version} has no downloadable tarball on the registry.`)
  const tarballBytes = await httpGetBytes(tarballUrl)
  writeFileAt(packageSubDir(cacheDir, spec, 'tarball'), `${spec.name}-${spec.version}.tgz`, tarballBytes)

  const extractDir = await extractTarball(tarballBytes)
  try {
    const root = findExtractedRoot(extractDir)
    const pkgJsonPath = join(root, 'package.json')
    if (!existsSync(pkgJsonPath)) throw new Error(`npm package "${spec.name}" ${spec.version}: the tarball has no package.json.`)
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as Record<string, unknown>
    const entryField = resolveEntryField(pkgJson).replace(/^\.\//, '')
    const entryCandidates = [join(root, entryField), join(root, `${entryField}.js`), join(root, entryField, 'index.js')]
    const entryPath = entryCandidates.find((c) => existsSync(c))
    if (!entryPath) {
      throw new Error(`npm package "${spec.name}" ${spec.version}: entry point "${entryField}" not found in the package.`)
    }

    const bundleText = await bundlePackage(spec, entryPath)
    return [{ filename: 'bundle.js', data: new TextEncoder().encode(bundleText) }]
  } finally {
    rmSync(extractDir, { recursive: true, force: true })
  }
}

/** Read a package's cached `bundle.js` as text, or `undefined` if it isn't
 * cached yet (the executor always calls `installPackages` before `run`, so a
 * miss here means the install genuinely never happened for this spec). */
export function readCachedBundle(cacheDir: string, spec: PackageSpec): string | undefined {
  const path = join(packageDir(cacheDir, spec), 'bundle.js')
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined
}

/**
 * Build the prelude injecting every pinned package's cached bundle into the
 * sandbox — evaluated AFTER the (cached, singleton) curated stdlib prelude, and
 * rebuilt fresh on every run from THIS node's `config.packages` (never cached
 * itself, unlike the stdlib one, since different nodes pin different sets).
 *
 * Each bundle is wrapped in its OWN IIFE (so its `var __pkgExports` never leaks
 * across packages) and handed to a shared `__definePkg`, which records it under
 * `require('<name>')` AND a bare global named after the package
 * ({@link npmPackageGlobalName}) — UNLESS that global name is already taken by
 * the curated prelude (e.g. a user pinning a package literally named `lodash`),
 * in which case only `require()` exposes it: the curated globals are never
 * clobbered, so an overlapping name can't break either side (curated or user).
 */
export function buildUserPackagesPrelude(cacheDir: string, packages: readonly PackageSpec[]): string {
  const setup = `
(function(){
  var g = globalThis;
  var __origRequire = g.require;
  g.__userPkgReq = g.__userPkgReq || Object.create(null);
  g.__definePkg = function(name, globalName, exported) {
    g.__userPkgReq[name] = exported;
    if (!(globalName in g)) g[globalName] = exported;
  };
  g.require = function(n) {
    if (Object.prototype.hasOwnProperty.call(g.__userPkgReq, n)) return g.__userPkgReq[n];
    return __origRequire(n);
  };
})();`
  const blocks = packages.map((spec) => {
    const bundle = readCachedBundle(cacheDir, spec)
    if (bundle === undefined) {
      throw new Error(`code deps: package "${spec.name}" ${spec.version} has no cached bundle — installPackages must run before run.`)
    }
    const globalName = npmPackageGlobalName(spec.name)
    return `(function(){\n${bundle}\nglobalThis.__definePkg(${JSON.stringify(spec.name)}, ${JSON.stringify(globalName)}, __pkgExports);\n})();`
  })
  return [setup, ...blocks].join('\n')
}

/** Every package currently cached under a per-language `cacheDir` (a `bundle.js`
 * present at its package root — see the module doc's cache-hit convention). */
function allCachedBundleSpecs(cacheDir: string): PackageSpec[] {
  if (!existsSync(cacheDir)) return []
  const specs: PackageSpec[] = []
  for (const entry of readdirSync(cacheDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const at = entry.name.lastIndexOf('@')
    if (at <= 0) continue
    if (existsSync(join(cacheDir, entry.name, 'bundle.js'))) {
      specs.push({ name: entry.name.slice(0, at), version: entry.name.slice(at + 1) })
    }
  }
  return specs
}

/** {@link CodeRuntime.mountPackages} for JS: inject every cached package into a
 * loaded QuickJS-like context. Exposed for tests against a real `QuickJSContext`
 * (mirrors `pythonRuntime`'s `mountPackages`) — production runs inject the same
 * cached bundles inline in `codeSandbox.ts` instead, since a fresh QuickJS
 * context is created per run anyway. */
export function mountPackagesIntoContext(engine: unknown, cacheDir: string): Promise<void> {
  const specs = allCachedBundleSpecs(cacheDir)
  if (specs.length === 0) return Promise.resolve()
  const prelude = buildUserPackagesPrelude(cacheDir, specs)
  const ctx = engine as {
    evalCode: (code: string) => { error?: { dispose: () => void }; value: { dispose: () => void } }
    dump: (h: unknown) => unknown
  }
  const result = ctx.evalCode(prelude)
  if (result.error) {
    const e: unknown = ctx.dump(result.error)
    result.error.dispose()
    throw new Error(`failed to mount user packages: ${typeof e === 'string' ? e : JSON.stringify(e)}`)
  }
  result.value.dispose()
  return Promise.resolve()
}
