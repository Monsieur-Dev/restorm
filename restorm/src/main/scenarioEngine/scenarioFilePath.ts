import { isAbsolute, resolve } from 'node:path'

/**
 * Resolve a `readFile`/`writeFile` path. An absolute path is used as-is; a
 * relative path is resolved against `workspaceDir` — the directory of the open
 * `.restorm` file (from SettingsService.getWorkspacePath, threaded through the
 * ExecContext) — so a scenario can ship a sidecar data file next to itself and
 * stay portable across machines / the build server. Falls back to the process
 * cwd when no workspace is known (e.g. a headless unit run).
 */
export function resolveWorkspacePath(p: string, workspaceDir?: string): string {
  if (p.trim() === '') throw new Error('file path is empty')
  if (isAbsolute(p)) return p
  return workspaceDir !== undefined && workspaceDir !== '' ? resolve(workspaceDir, p) : resolve(p)
}
