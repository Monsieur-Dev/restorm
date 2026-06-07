import { isAbsolute, resolve, relative } from 'node:path'

/**
 * Resolve + CONTAIN a `readFile`/`writeFile` path. A relative path resolves
 * against `workspaceDir` — the directory of the open `.restorm` file (from
 * SettingsService.getWorkspacePath, threaded through the ExecContext) — so a
 * scenario can ship a sidecar data file next to itself and stay portable across
 * machines / the build server. An absolute path is taken as-is.
 *
 * Either way the resolved path MUST stay inside the workspace root: a scenario
 * file can be shared and then run by someone else, so its `readFile`/`writeFile`
 * boxes must not escape to arbitrary local paths (`../../etc/passwd`,
 * `~/.ssh/id_rsa`, …) under the app's privileges. An escaping path THROWS →
 * routing to the node's `error` port. Falls back to the process cwd as the root
 * when no workspace is known (e.g. a headless unit run).
 */
export function resolveWorkspacePath(p: string, workspaceDir?: string): string {
  if (p.trim() === '') throw new Error('file path is empty')
  const root = resolve(workspaceDir !== undefined && workspaceDir !== '' ? workspaceDir : '.')
  const resolved = isAbsolute(p) ? resolve(p) : resolve(root, p)
  const rel = relative(root, resolved)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`file path escapes the workspace: ${p}`)
  }
  return resolved
}
