import { randomUUID } from 'crypto'
import { mkdirSync } from 'fs'
import { join } from 'path'

/**
 * Per-launch userData isolation.
 *
 * Returns a fresh, repo-local, gitignored absolute directory path
 * suitable for `RESTORM_USER_DATA_OVERRIDE`. Pass it to every
 * `electron.launch` call within the same scenario (bootstrap + real
 * launch + relaunches) so they all share the same isolated userData
 * — drafts, config.json, recent files, toolbar layout, etc. — without
 * leaking into the developer's real `~/.config/restorm/` and without
 * stomping on parallel agents running from another worktree.
 *
 * The directory is created eagerly so Restorm's main process boot
 * can `app.setPath('userData', …)` to it without hitting an
 * ENOENT-on-create race.
 */
export function createIsolatedUserDataDir(restormRoot: string): string {
  const dir = join(restormRoot, 'tests/e2e/.tmp/userdata', randomUUID())
  mkdirSync(dir, { recursive: true })
  return dir
}
