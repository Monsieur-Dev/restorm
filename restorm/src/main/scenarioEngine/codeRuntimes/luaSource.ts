/**
 * Lua dependency resolution for the `code` node — turns a user's pinned
 * LuaRocks module name into a cached, pure-Lua `.lua` source file ready for
 * wasmoon's `package.preload` to load offline.
 *
 * ## Why pure-Lua-only + why we never eval the registry's Lua
 * wasmoon runs Lua 5.4 compiled to WASM, so a rock with a compiled `.c`
 * dependency has no build target here — only source-level, pure-Lua modules
 * can be mounted. LuaRocks has no per-package JSON REST endpoint; a package's
 * metadata lives in two places we DO fetch as plain text/JSON:
 *
 *   - `https://luarocks.org/manifest-5.4.json` — the whole registry index, a
 *     real JSON document (`repository[name][version-revision] = [{arch}, …]`),
 *     used only to resolve the user's pinned `version` to LuaRocks' internal
 *     `<version>-<revision>` key (LuaRocks versions always carry a revision
 *     suffix the user doesn't pin).
 *   - `https://luarocks.org/<name>-<version>-<revision>.rockspec` — the
 *     rockspec itself: a Lua table literal naming `source.url` (typically a
 *     GitHub archive tarball), `build.type`, and `build.modules` (dotted
 *     module name → relative `.lua`/`.c` path).
 *
 * The rockspec is **parsed with a small regex-based reader**, never with a
 * real Lua interpreter — evaluating a registry-served Lua chunk in the main
 * process (which has full OS access) would be a code-execution vector. The
 * regex reader only ever extracts quoted string values out of the `source` /
 * `build` / `build.modules` blocks; it can't execute anything.
 */
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as tar from 'tar'
import { httpGetBytes, httpGetText, type ArtifactFetcher, type FetchedArtifact } from './depsInstaller'
import type { PackageSpec } from './types'

const LUAROCKS_MANIFEST_URL = 'https://luarocks.org/manifest-5.4.json'
const LUAROCKS_BASE = 'https://luarocks.org'

interface LuaManifest { repository?: Record<string, Record<string, unknown> | undefined> }

/** Build types whose output is plain Lua source — anything else (`make`,
 * `cmake`, `command`, …) compiles native code and can't run in WASM. */
const PURE_LUA_BUILD_TYPES = new Set(['builtin', 'module', 'none'])

/** A rockspec's fields relevant to fetching + validating a pure-Lua module. */
export interface ParsedRockspec {
  sourceUrl: string
  buildType: string
  /** Dotted module name → path relative to the archive's single root folder. */
  modules: Record<string, string>
}

/**
 * Resolve the user's pinned bare `version` to LuaRocks' `<version>-<revision>`
 * manifest key, given the already-parsed `repository[name]` object (a map of
 * those keys to an arch list — the arch list itself is irrelevant here, only
 * the key matters). Picks the highest revision when more than one exists.
 * Pure function — no network — so it's directly unit-testable against a
 * hand-built manifest fragment.
 */
export function resolveRevision(versions: Record<string, unknown>, version: string): string | undefined {
  const prefix = `${version}-`
  let best: number | undefined
  for (const key of Object.keys(versions)) {
    if (!key.startsWith(prefix)) continue
    const revision = Number(key.slice(prefix.length))
    if (!Number.isInteger(revision)) continue
    if (best === undefined || revision > best) best = revision
  }
  return best === undefined ? undefined : `${version}-${best}`
}

/** Find the first `<key> = { ... }` block in `raw` and return its inner text
 * (balanced-brace scan) — used to descend `source`, `build`, and
 * `build.modules` without evaluating any Lua. Returns undefined when the key
 * isn't present or its braces never close. */
function extractBlock(raw: string, key: string): string | undefined {
  const marker = new RegExp(`${key}\\s*=\\s*\\{`)
  const m = marker.exec(raw)
  if (!m) return undefined
  let depth = 1
  let i = m.index + m[0].length
  const start = i
  while (i < raw.length && depth > 0) {
    if (raw[i] === '{') depth++
    else if (raw[i] === '}') depth--
    i++
  }
  return depth === 0 ? raw.slice(start, i - 1) : undefined
}

/** Pull a `key = "value"` (or `'value'`) string out of a block — the only
 * shape this reader needs from a rockspec's `source` / `build` tables. */
function matchQuotedString(block: string, key: string): string | undefined {
  const m = new RegExp(`${key}\\s*=\\s*["']([^"']+)["']`).exec(block)
  return m?.[1]
}

/**
 * Parse a rockspec's text into the fields needed to fetch + validate a
 * module. Regex-only (see the module doc for why) — good enough for the
 * constrained "Lua table literal" shape every rockspec uses, without ever
 * executing the untrusted registry response.
 */
export function parseRockspec(raw: string, name: string): ParsedRockspec {
  const sourceBlock = extractBlock(raw, 'source')
  const sourceUrl = sourceBlock ? matchQuotedString(sourceBlock, 'url') : undefined
  if (sourceUrl === undefined) {
    throw new Error(`Lua module "${name}": rockspec has no readable "source.url".`)
  }
  const buildBlock = extractBlock(raw, 'build')
  const buildType = (buildBlock ? matchQuotedString(buildBlock, 'type') : undefined) ?? 'builtin'
  const modulesBlock = buildBlock ? extractBlock(buildBlock, 'modules') : undefined
  const modules: Record<string, string> = {}
  if (modulesBlock) {
    const re = /([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*["']([^"']+)["']/g
    for (const m of modulesBlock.matchAll(re)) {
      const modName = m[1]
      const modPath = m[2]
      if (modName !== undefined && modPath !== undefined) modules[modName] = modPath
    }
  }
  return { sourceUrl, buildType, modules }
}

/**
 * Reject anything the WASM runtime can't load: a non-source build type
 * (compiles native code) or a declared module whose path isn't `.lua`. Throws
 * the exact, user-readable message the node's `error` port surfaces.
 */
export function assertPureLua(name: string, spec: ParsedRockspec): void {
  if (!PURE_LUA_BUILD_TYPES.has(spec.buildType)) {
    throw new Error(`Lua module ${name} has C dependencies, not supported in the WASM runtime.`)
  }
  const entries = Object.entries(spec.modules)
  if (entries.length === 0) {
    throw new Error(`Lua module "${name}": rockspec declares no built modules.`)
  }
  for (const [, modPath] of entries) {
    if (!modPath.toLowerCase().endsWith('.lua')) {
      throw new Error(`Lua module ${name} has C dependencies, not supported in the WASM runtime.`)
    }
  }
}

/**
 * Extract a set of wanted paths from a gzipped tarball (a GitHub archive
 * tarball, e.g.) into memory. Uses `node-tar` for the actual archive parsing
 * (its hardening against `..` / absolute-path / symlink escapes is battle-
 * tested — this module deliberately does not hand-roll a TAR reader), after a
 * plain `zlib.gunzipSync`. Archives always unpack under one root folder
 * (`strip: 1` removes it), so `wantedPaths` are the paths `build.modules`
 * gives, relative to that root. Extraction happens in a throwaway scratch
 * directory under the OS temp dir, cleaned up unconditionally.
 */
export async function extractFiles(tarballBytes: Uint8Array, wantedPaths: readonly string[]): Promise<Map<string, Uint8Array>> {
  const scratch = mkdtempSync(join(tmpdir(), 'restorm-lua-src-'))
  try {
    const tarBuffer = gunzipSync(Buffer.from(tarballBytes))
    const tarFile = join(scratch, 'source.tar')
    writeFileSync(tarFile, tarBuffer)
    const extractDir = join(scratch, 'extracted')
    mkdirSync(extractDir, { recursive: true })
    const wanted = new Set(wantedPaths)
    await tar.x({
      file: tarFile,
      cwd: extractDir,
      strip: 1,
      filter: (entryPath: string) => {
        for (const w of wanted) {
          if (entryPath === w || entryPath.endsWith(`/${w}`)) return true
        }
        return false
      }
    })
    const out = new Map<string, Uint8Array>()
    for (const p of wantedPaths) {
      const dest = join(extractDir, p)
      if (existsSync(dest)) out.set(p, new Uint8Array(readFileSync(dest)))
    }
    return out
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/** The {@link ArtifactFetcher} for Lua: resolve a LuaRocks `name@version` to
 * its pure-Lua source file(s) and download them. Throws a user-readable,
 * error-port-bound message when the module/version can't be resolved or ships
 * a native build. One {@link FetchedArtifact} per declared module (most
 * modules declare exactly one), named `<dotted.module.name>.lua`. */
export const luaModuleFetcher: ArtifactFetcher = async (spec: PackageSpec): Promise<FetchedArtifact[]> => {
  const manifestRaw = await httpGetText(LUAROCKS_MANIFEST_URL)
  let manifest: LuaManifest
  try {
    manifest = JSON.parse(manifestRaw) as LuaManifest
  } catch {
    throw new Error('Lua module registry (LuaRocks) returned an unreadable manifest.')
  }
  const versions = manifest.repository?.[spec.name]
  if (!versions) throw new Error(`Lua module "${spec.name}" was not found on LuaRocks.`)
  const versionRevision = resolveRevision(versions, spec.version)
  if (versionRevision === undefined) {
    throw new Error(`Lua module "${spec.name}" has no version "${spec.version}" on LuaRocks.`)
  }

  const rockspecUrl = `${LUAROCKS_BASE}/${encodeURIComponent(spec.name)}-${versionRevision}.rockspec`
  let rockspecRaw: string
  try {
    rockspecRaw = await httpGetText(rockspecUrl)
  } catch {
    throw new Error(`Lua module "${spec.name}" ${spec.version} rockspec could not be fetched from LuaRocks.`)
  }
  const rockspec = parseRockspec(rockspecRaw, spec.name)
  assertPureLua(spec.name, rockspec)

  if (!/\.(tar\.gz|tgz)$/i.test(rockspec.sourceUrl)) {
    throw new Error(`Lua module "${spec.name}": unsupported source archive format at ${rockspec.sourceUrl} (expected a .tar.gz).`)
  }
  const tarballBytes = await httpGetBytes(rockspec.sourceUrl)
  const wantedPaths = Object.values(rockspec.modules)
  const extracted = await extractFiles(tarballBytes, wantedPaths)

  const artifacts: FetchedArtifact[] = []
  for (const [modName, modPath] of Object.entries(rockspec.modules)) {
    const data = extracted.get(modPath)
    if (!data) {
      throw new Error(`Lua module "${spec.name}": source file "${modPath}" for "${modName}" was not found in the downloaded archive.`)
    }
    artifacts.push({ filename: `${modName}.lua`, data })
  }
  return artifacts
}
