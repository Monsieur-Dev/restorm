import { resolve, relative, isAbsolute } from 'path'

/**
 * Verify that a resolved path stays within the expected parent directory.
 * Throws if the path would escape (e.g., via `../` traversal).
 */
export function assertPathWithinParent(parentPath: string, childPath: string): void {
  const resolved = resolve(parentPath, childPath)
  const rel = relative(parentPath, resolved)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Path traversal detected: "${childPath}" resolves outside "${parentPath}"`)
  }
}

/**
 * Fail-CLOSED containment check for renderer-supplied paths that must
 * live inside the opened project folder (secrets read/write,
 * save-as-folder re-save). Returns `true` only when `containerPath` is
 * a non-empty directory AND `targetPath` resolves within it. A missing
 * container (no folder open / single-file mode) is NOT a free pass —
 * it returns `false`, so the caller refuses the operation rather than
 * letting a raw path reach the filesystem.
 */
export function isPathContained(containerPath: string | null | undefined, targetPath: string): boolean {
  if (!containerPath || !targetPath) return false
  try {
    assertPathWithinParent(containerPath, targetPath)
    return true
  } catch {
    return false
  }
}
