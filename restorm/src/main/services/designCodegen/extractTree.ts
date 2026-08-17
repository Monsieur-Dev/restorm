/**
 * Controlled MEMFS→disk extraction — the LAST line of defence between a
 * template's output and the user's machine. Whatever the sandbox
 * produced, only paths that normalize INSIDE the validated output root
 * are written; anything else fails the whole extraction BEFORE the
 * first byte lands (no partial trees on refusal).
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path'

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
  return normalized
}

/** Validate EVERY path first, then write — refusal leaves no partial
 * tree. Returns the written relative paths. */
export function extractGeneratedTree(files: readonly GeneratedFile[], outputRoot: string): string[] {
  const root = resolve(outputRoot)
  const targets = files.map((file) => {
    const relative = assertSafeRelativePath(file.path)
    const absolute = resolve(join(root, relative))
    // Belt over braces: even a path that slipped the syntactic checks
    // must resolve INSIDE the root.
    if (absolute !== root && !absolute.startsWith(root + sep)) {
      throw new Error(`generated path escapes the output folder: ${file.path}`)
    }
    return { absolute, relative, data: Buffer.from(file.b64, 'base64') }
  })
  for (const target of targets) {
    mkdirSync(dirname(target.absolute), { recursive: true })
    writeFileSync(target.absolute, target.data)
  }
  return targets.map((t) => t.relative)
}
