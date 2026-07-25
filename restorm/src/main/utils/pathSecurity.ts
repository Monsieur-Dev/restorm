import { resolve, relative, isAbsolute } from 'path'
import { statSync } from 'fs'

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

/**
 * The containment boundary for a renderer-supplied save target, derived
 * from the path the app currently has open.
 *
 * Folder mode records the FOLDER itself as the open project, and that
 * folder is the boundary as-is — deriving it with `dirname()` would widen
 * it to the parent and re-admit every sibling project. A single open
 * *file* has no folder boundary to enforce (the initial save-as that
 * establishes a folder runs with nothing open), and neither does an
 * unsaved document; both yield `null`, meaning "no boundary applies".
 *
 * The directory test is what distinguishes the two modes: the service
 * stores both in the same field, so the filesystem is the only thing that
 * can tell a project folder from a project file.
 */
export function resolveOpenedFolderBoundary(openProjectPath: string | null | undefined): string | null {
  if (!openProjectPath) return null
  try {
    return statSync(openProjectPath).isDirectory() ? openProjectPath : null
  } catch {
    // Vanished or unreadable between the open and this call — no boundary
    // can be proven, so report none rather than guessing at one.
    return null
  }
}
