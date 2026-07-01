/**
 * Service for importing TypeSpec (`.tsp`) API definitions into Restorm
 * collections.
 *
 * TypeSpec doesn't have a native Restorm parser. Strategy A — the only one
 * implemented here — shells out to Restorm's OWN bundled `tsp compile`
 * (`@typespec/compiler` is a real `dependencies` entry, not a devDependency,
 * so it ships in every build) to emit an OpenAPI 3.x document, then
 * delegates to the existing OpenAPI importer for the actual folder / request
 * materialisation. Users need nothing installed — no global `tsp`, no
 * project-level TypeSpec libraries, and (see `resolveTspCliEntry` /
 * `importTypeSpec`) no system Node either — the compiler's JS entry point
 * runs through Electron's own embedded Node (`process.execPath` +
 * `ELECTRON_RUN_AS_NODE=1`), not a `tsp` binary resolved via `PATH`. Parsing
 * `.tsp` directly via the compiler's programmatic API (self-contained, no
 * CLI subprocess) is a possible follow-up but out of scope here — see
 * `docs/imports/typespec.md`.
 *
 * File-based only: a `.tsp` file commonly `import`s TypeSpec libraries
 * (`@typespec/http`, …), and the compiler resolves those imports via ordinary
 * Node module resolution. Restricting to file-based imports (never paste,
 * never a URL) keeps the contract simple to reason about; see the Trust
 * model note below for why the resolution itself is deliberately NOT rooted
 * at the source file's own directory.
 *
 * Trust model / isolated compilation: `tsp compile` doesn't just parse text
 * — it EXECUTES the decorator libraries / emitters the `.tsp` file (or a
 * `tspconfig.yaml` sitting next to it) references. Compiling the file
 * in-place would resolve those against the SOURCE file's own directory,
 * meaning an attacker-controlled directory (a malicious `.tsp` shipped
 * alongside its own `node_modules` / `tspconfig.yaml`) could execute
 * arbitrary Node code during import. To avoid that, this importer copies
 * only the `.tsp` CONTENT into a fresh, isolated temp directory and symlinks
 * OUR OWN `node_modules` into it (see `createIsolatedSourceDir` /
 * `resolveOwnNodeModulesDir`) — so `import "@typespec/http"` etc. always
 * resolves to the library version Restorm itself ships, never anything from
 * the imported file's real directory. A `tspconfig.yaml` or `node_modules`
 * sitting next to the source file is therefore never consulted. The
 * tradeoff: relative imports to sibling `.tsp` files (multi-file TypeSpec
 * projects) don't resolve — single-file specs only. Documented in
 * `docs/imports/typespec.md`.
 */

import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'yaml'
import type { EnvironmentFolder } from '../../../shared/models'
import { importOpenAPI } from './OpenAPIImportService'
import type { OAS3Spec } from './transformers/openapi3ToApiDocumentation'
import type { OAS31Spec } from './transformers/openapi31ToApiDocumentation'

/** Hard cap on `tsp compile` wall time — a hung or very large project must
 * not block the import UI forever. */
const COMPILE_TIMEOUT_MS = 30_000

export interface TypeSpecImportOptions {
  /** Base URL override, forwarded to the delegate OpenAPI importer. */
  baseUrl?: string
}

/**
 * Recursively find the emitted OpenAPI document under `dir`. The
 * `@typespec/openapi3` emitter nests it under `<outputDir>/@typespec/openapi3/`
 * today, but that layout is an implementation detail of the emitter — search
 * instead of hard-coding the path so a future compiler version that changes
 * the nesting doesn't silently break the import.
 */
function findEmittedOpenApiFile(dir: string): string | undefined {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = findEmittedOpenApiFile(full)
      if (found) return found
    } else if (/^openapi\.(ya?ml|json)$/.test(entry.name)) {
      return full
    }
  }
  return undefined
}

/**
 * Walk up from `startDir` looking for a `node_modules/@typespec/compiler`
 * directory, returning the `node_modules` that contains it. Throws — never
 * falls back to anything else — when none is found anywhere up to the
 * filesystem root.
 *
 * This is Restorm's fail-closed guarantee: if the isolated compile's trusted
 * library set can't be located, TypeSpec import must refuse to run rather
 * than silently falling back to resolving against the (untrusted) source
 * file's own directory, which would reopen the exact RCE isolation exists to
 * close. Kept as a standalone, parameterised function (rather than inlined
 * into `resolveOwnNodeModulesDir`) so this invariant is directly testable
 * with a synthetic `startDir` that has no `@typespec/compiler` anywhere in
 * its ancestry, without needing to fake or delete a real install.
 */
export function findAncestorNodeModulesWithTypeSpecCompiler(startDir: string): string {
  let dir = startDir
  for (;;) {
    if (fs.existsSync(path.join(dir, 'node_modules', '@typespec', 'compiler'))) {
      return path.join(dir, 'node_modules')
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      throw new Error('Could not locate a local @typespec/compiler install — TypeSpec import needs it as a dependency of this application')
    }
    dir = parent
  }
}

/**
 * Resolve the `node_modules` directory that holds Restorm's OWN
 * `@typespec/*` install — the trusted library set the isolated compile
 * symlinks in. Walks up from THIS module's own file location (works both
 * from source under `vitest` and from a built `dist/main/...` bundle).
 *
 * Deliberately does NOT use `createRequire(import.meta.url).resolve(...)`
 * (the pattern `codeRuntimes/luaRuntime.ts` / `rRuntime.ts` use for other
 * runtime deps) — pnpm's per-package isolated store
 * (`node_modules/.pnpm/@typespec+compiler@.../node_modules`) only contains
 * `@typespec/compiler`'s OWN dependencies, not the sibling `@typespec/http`
 * / `@typespec/openapi3` packages this importer also needs, which are
 * separate top-level `dependencies` entries. Walking up to the shared
 * top-level `node_modules` (where pnpm symlinks every direct dependency) is
 * what actually exposes all of them together.
 */
function resolveOwnNodeModulesDir(): string {
  return findAncestorNodeModulesWithTypeSpecCompiler(path.dirname(fileURLToPath(import.meta.url)))
}

/**
 * Materialise `content` as a standalone `.tsp` entry point inside a fresh,
 * isolated temp directory that has no relationship to wherever the user's
 * original file lives, then symlink Restorm's own `node_modules`
 * (`ownNodeModulesDir`) into it so the compiler's library imports resolve to
 * trusted code. See the module doc's Trust model note for the full
 * rationale.
 */
function createIsolatedSourceDir(content: string, ownNodeModulesDir: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'restorm-typespec-src-'))
  fs.writeFileSync(path.join(dir, 'main.tsp'), content, 'utf-8')
  fs.symlinkSync(ownNodeModulesDir, path.join(dir, 'node_modules'), 'dir')
  return dir
}

/**
 * Resolve the `tsp` CLI's JS entry point from Restorm's own bundled
 * `@typespec/compiler`, reading the path out of the package's own `bin.tsp`
 * field (`package.json`) rather than hard-coding `cmd/tsp.js` — the exact
 * relative path is an implementation detail of the compiler package, not a
 * documented contract.
 *
 * Deliberately NOT `<node_modules>/.bin/tsp` (pnpm's shell shim) — that shim
 * is a `#!/bin/sh` script whose fallback path does `exec node ...`, which
 * needs a `node` binary discoverable on `PATH` wherever it runs. A packaged
 * Electron app doesn't guarantee that (Electron embeds its own Node, not
 * necessarily exposed as a system `node`). Spawning this JS entry directly
 * via `process.execPath` with `ELECTRON_RUN_AS_NODE=1` (see `importTypeSpec`)
 * runs it through Electron's OWN embedded Node instead, so nothing external
 * to Restorm is ever required.
 */
function resolveTspCliEntry(ownNodeModulesDir: string): string {
  const compilerDir = path.join(ownNodeModulesDir, '@typespec', 'compiler')
  const pkg = JSON.parse(fs.readFileSync(path.join(compilerDir, 'package.json'), 'utf-8')) as { bin?: Record<string, string> }
  const tspEntry = pkg.bin?.tsp
  if (tspEntry === undefined) {
    throw new Error('@typespec/compiler\'s package.json has no "tsp" bin entry — cannot resolve the TypeSpec compiler')
  }
  return path.join(compilerDir, tspEntry)
}

/**
 * Compile TypeSpec `content` to OpenAPI 3.x via Restorm's OWN bundled `tsp`
 * compiler (isolated from the original source location, see the module doc)
 * and import the result through the existing OpenAPI importer.
 *
 * Invoked as `process.execPath <tspCliEntry.js> compile ...` with
 * `ELECTRON_RUN_AS_NODE=1` — Electron's own binary running as plain Node —
 * rather than a `tsp` binary resolved via `PATH` or even pnpm's own
 * `.bin/tsp` shim (see `resolveTspCliEntry`). `@typespec/compiler` is a real
 * `dependencies` entry (bundled into every build, dev and packaged), so this
 * works identically whether Restorm is run from source or as a packaged app
 * with no TypeSpec tooling — and no system Node — installed anywhere on the
 * user's machine. Users need nothing installed.
 */
export function importTypeSpec(content: string, options: TypeSpecImportOptions = {}): EnvironmentFolder {
  const ownNodeModulesDir = resolveOwnNodeModulesDir()
  const tspCliEntry = resolveTspCliEntry(ownNodeModulesDir)
  const sourceDir = createIsolatedSourceDir(content, ownNodeModulesDir)
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'restorm-typespec-out-'))
  try {
    // `NODE_OPTIONS` / `NODE_PATH` are dropped from the child's environment
    // — both are inherited from Restorm's own process, but if set they'd
    // let a stray `--require` or an out-of-tree module-resolution root
    // influence the compiler's own Node process; everything else is passed
    // through unchanged. `ELECTRON_RUN_AS_NODE: '1'` makes `process.execPath`
    // (Electron's own binary) behave as a plain Node runtime for this one
    // child process — harmless / a no-op when Restorm itself is already
    // running under plain Node (tests, CI).
    const { NODE_OPTIONS: _discardedNodeOptions, NODE_PATH: _discardedNodePath, ...scrubbedEnv } = process.env
    const result = spawnSync(
      process.execPath,
      [tspCliEntry, 'compile', path.join(sourceDir, 'main.tsp'), '--emit', '@typespec/openapi3', '--output-dir', outputDir],
      { encoding: 'utf-8', timeout: COMPILE_TIMEOUT_MS, env: { ...scrubbedEnv, ELECTRON_RUN_AS_NODE: '1' } }
    )

    if (result.error) {
      const notFound = (result.error as NodeJS.ErrnoException).code === 'ENOENT'
      throw new Error(notFound
        ? 'TypeSpec compiler is missing from this Restorm installation — this looks like a broken or incomplete install; try reinstalling Restorm.'
        : `Failed to run the TypeSpec compiler: ${result.error.message}`)
    }
    if (result.status !== 0) {
      const timedOut = result.signal !== null
      const message = (result.stderr || result.stdout || '').trim()
      throw new Error(timedOut
        ? `TypeSpec compilation timed out after ${COMPILE_TIMEOUT_MS / 1000}s`
        : `TypeSpec compilation failed${message ? `: ${message}` : ''}`)
    }

    const emittedFile = findEmittedOpenApiFile(outputDir)
    if (!emittedFile) {
      throw new Error('TypeSpec compilation succeeded but produced no OpenAPI output — is @typespec/openapi3 configured for this project?')
    }

    // The emitter's default output is YAML — parse it ourselves rather than
    // forcing a `file-type=json` emitter option, so this keeps working
    // against the compiler's default configuration regardless of project
    // settings. `yaml.parse` handles JSON too (YAML is a JSON superset),
    // so a project configured to emit `openapi.json` works the same way.
    const spec = yaml.parse(fs.readFileSync(emittedFile, 'utf-8')) as OAS3Spec | OAS31Spec
    const folder = importOpenAPI(spec, options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {})
    // `importOpenAPI` stamps `importSource: 'openapi'` — override it so a
    // re-import / refresh can tell this folder actually came from a `.tsp`
    // source.
    folder.importSource = 'typespec'
    return folder
  } finally {
    // `rmSync(..., { recursive: true })` on a directory that CONTAINS a
    // symlink unlinks the symlink entry itself — it does not follow it into
    // the target — so this never touches Restorm's real `node_modules`.
    fs.rmSync(sourceDir, { recursive: true, force: true })
    fs.rmSync(outputDir, { recursive: true, force: true })
  }
}

// ============================================================================
// Provider registration
// ============================================================================

import { importProviders } from './registry'

function canImport(_content: string, filePath?: string): boolean {
  return filePath?.toLowerCase().endsWith('.tsp') ?? false
}

function parse(content: string, opts: { sourceUrl?: string; filePath?: string }): EnvironmentFolder {
  if (opts.filePath === undefined) {
    throw new Error('TypeSpec import only supports local .tsp files (paste and URL imports are not supported)')
  }
  // The already-extracted `content` is compiled in isolation (see the
  // module doc) — `opts.filePath` is only used to gate file-based-only
  // detection, never to compile the file in its real location.
  return importTypeSpec(content)
}

importProviders.push({ format: 'typespec', canImport, parse })
