/**
 * Controlled MEMFS→disk extraction — the LAST line of defence between a
 * template's output and the user's machine. Whatever the sandbox
 * produced, only paths that normalize INSIDE the validated output root
 * are written; anything else fails the whole extraction BEFORE the
 * first byte lands (no partial trees on refusal).
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path'
import { threeWayMerge } from '../../../shared/design/threeWayMerge'

/** Sidecar (in the output root) holding the LAST render of each file, so a
 * re-generation can 3-way merge the template's changes onto the user's edits
 * (the `copier update` role) instead of overwriting. */
const BASE_SNAPSHOT = '.restorm-codegen-base.json'

export interface GeneratedFile {
  /** Path RELATIVE to the output root, `/` separated. */
  path: string
  /** Base64 content. */
  b64: string
}

/** Reject a generated path that could land outside the root: absolute,
 * drive-lettered, `..`-traversing, empty or NUL-carrying. Returns the
 * normalized relative path. */
export function assertSafeRelativePath(path: string): string {
  if (path === '' || path.includes('\0')) throw new Error(`unsafe generated path: ${JSON.stringify(path)}`)
  if (isAbsolute(path) || /^[A-Za-z]:/.test(path) || path.startsWith('\\\\')) {
    throw new Error(`generated path is absolute: ${path}`)
  }
  const normalized = normalize(path)
  if (normalized === '..' || normalized.startsWith(`..${sep}`) || normalized.split(sep).includes('..')) {
    throw new Error(`generated path escapes the output folder: ${path}`)
  }
  // A path that normalizes onto the root ITSELF (`.` / `./`) would make
  // the write phase hit the directory — refuse it up front.
  const trimmed = normalized.endsWith(sep) ? normalized.slice(0, -1) : normalized
  if (trimmed === '.' || trimmed === '') throw new Error(`unsafe generated path: ${JSON.stringify(path)}`)
  return trimmed
}

interface Target { absolute: string; relative: string; data: Buffer }

/** Validate EVERY generated path against the (resolved) root — refusal here
 * leaves no partial tree, since nothing is written yet. */
function validateTargets(files: readonly GeneratedFile[], root: string): Target[] {
  return files.map((file) => {
    const relative = assertSafeRelativePath(file.path)
    const absolute = resolve(join(root, relative))
    // Belt over braces: even a path that slipped the syntactic checks
    // must resolve INSIDE the root.
    if (absolute === root || !absolute.startsWith(root + sep)) {
      throw new Error(`generated path escapes the output folder: ${file.path}`)
    }
    return { absolute, relative, data: Buffer.from(file.b64, 'base64') }
  })
}

/** Make each target's parent dir, refusing a symlink that would carry the write
 * outside the real root. */
function ensureParentInsideRoot(target: Target, realRoot: string): void {
  mkdirSync(dirname(target.absolute), { recursive: true })
  const realParent = realpathSync(dirname(target.absolute))
  if (realParent !== realRoot && !realParent.startsWith(realRoot + sep)) {
    throw new Error(`generated path resolves outside the output folder (symlink): ${target.relative}`)
  }
}

/** Validate EVERY path first, then write — refusal leaves no partial
 * tree. Returns the written relative paths. */
export function extractGeneratedTree(files: readonly GeneratedFile[], outputRoot: string): string[] {
  const root = resolve(outputRoot)
  const targets = validateTargets(files, root)
  mkdirSync(root, { recursive: true })
  const realRoot = realpathSync(root)
  for (const target of targets) {
    try {
      ensureParentInsideRoot(target, realRoot)
      writeFileSync(target.absolute, target.data)
    } catch (error) {
      // A LATE failure is reported as what it is — an interrupted
      // write, never a validation refusal (the refusal path above
      // writes nothing at all).
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`extraction interrupted at ${target.relative}: ${message}`)
    }
  }
  return targets.map((t) => t.relative)
}

/** UTF-8 text, or `null` for a binary file (NUL byte) that must be overwritten
 * wholesale rather than line-merged. */
function asText(data: Buffer): string | null {
  return data.includes(0) ? null : data.toString('utf8')
}

function readBaseSnapshot(root: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(root, BASE_SNAPSHOT), 'utf8'))
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (typeof v === 'string') out[k] = v
      return out
    }
  } catch { /* absent / unreadable → first generation, no base */ }
  return {}
}

export interface MergeExtractResult {
  /** All written relative paths. */
  written: string[]
  /** Paths whose 3-way merge left conflict markers. */
  conflicts: string[]
}

/**
 * Extraction with a 3-way MERGE (the codegen "update", Copier-style): each
 * produced TEXT file is merged onto the user's current file using the previous
 * render (the {@link BASE_SNAPSHOT} sidecar) as the common ancestor, so the
 * template's changes land WITHOUT clobbering the user's edits. Files with no
 * prior base (first generation / new files) and binary files are written whole.
 * The new render is persisted as the next base.
 */
export function extractGeneratedTreeMerging(files: readonly GeneratedFile[], outputRoot: string): MergeExtractResult {
  const root = resolve(outputRoot)
  const targets = validateTargets(files, root)
  mkdirSync(root, { recursive: true })
  const realRoot = realpathSync(root)
  const base = readBaseSnapshot(root)
  const nextBase: Record<string, string> = {}
  const written: string[] = []
  const conflicts: string[] = []
  for (const target of targets) {
    try {
      ensureParentInsideRoot(target, realRoot)
      const newText = asText(target.data)
      if (newText === null) {
        writeFileSync(target.absolute, target.data)
        written.push(target.relative)
        continue
      }
      nextBase[target.relative] = newText
      const baseText = base[target.relative]
      const current = existsSync(target.absolute) ? readFileSync(target.absolute, 'utf8') : undefined
      if (baseText !== undefined && current !== undefined) {
        const merged = threeWayMerge(baseText, current, newText)
        writeFileSync(target.absolute, merged.text)
        if (merged.conflict) conflicts.push(target.relative)
      } else {
        writeFileSync(target.absolute, newText)
      }
      written.push(target.relative)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`extraction interrupted at ${target.relative}: ${message}`)
    }
  }
  writeFileSync(join(root, BASE_SNAPSHOT), JSON.stringify(nextBase, null, 2))
  return { written, conflicts }
}
