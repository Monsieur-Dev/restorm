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
