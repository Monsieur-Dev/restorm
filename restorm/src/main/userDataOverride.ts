/**
 * Test-isolation hook.
 *
 * Restorm persists everything that survives an app restart — drafts,
 * config.json, recent files, toolbar layout, etc. — under
 * `app.getPath('userData')`. On Linux that resolves to
 * `~/.config/restorm/`, on macOS to `~/Library/Application Support/restorm/`,
 * on Windows to `%APPDATA%/restorm/`.
 *
 * That single OS-level location is a global shared mutable. Two
 * parallel agents (or the user + an agent) running `pnpm test:e2e`
 * from different worktrees stomp on each other's drafts; a failing
 * teardown leaks state into the developer's real account.
 *
 * `app.setPath('userData', <abs-path>)` is the lightest possible fix:
 * Electron explicitly supports calling it before `app.whenReady()`,
 * and after this call every downstream consumer of
 * `app.getPath('userData')` (StorageService, DraftStore, the CLI's
 * `clearUserSettings`, FileOperations.getDraftsRoot, etc.)
 * automatically follows. No threading needed.
 *
 * This helper reads `RESTORM_USER_DATA_OVERRIDE` from the environment
 * and, if it points to a non-blank path, applies the redirect.
 * Production / dev runs leave the var unset and behaviour is
 * unchanged. The e2e launcher sets it to a unique
 * `tests/e2e/.tmp/userdata/<uuid>/` per app launch.
 */

interface UserDataPathSetter {
  setPath(name: 'userData', value: string): void
}

interface UserDataOverrideResult {
  applied: boolean
  /** Absolute (caller-supplied) path that was applied, when `applied` is true. */
  path?: string
}

/**
 * Apply a `userData` override from `env['RESTORM_USER_DATA_OVERRIDE']`
 * if present and non-blank. Idempotent and safe to call before
 * `app.whenReady()`. Returns whether the override was applied so the
 * caller can log / assert on it.
 */
export function applyUserDataOverride(
  app: UserDataPathSetter,
  env: NodeJS.ProcessEnv = process.env
): UserDataOverrideResult {
  const raw = env['RESTORM_USER_DATA_OVERRIDE']
  if (raw === undefined) return { applied: false }
  const trimmed = raw.trim()
  if (trimmed.length === 0) return { applied: false }
  app.setPath('userData', trimmed)
  return { applied: true, path: trimmed }
}
