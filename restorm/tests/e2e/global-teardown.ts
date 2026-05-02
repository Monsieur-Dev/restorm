import { rmSync } from 'fs'
import { resolve } from 'path'

/**
 * Wipe per-test workspaces (`tests/e2e/.tmp`) at the end of every run. The
 * generated specs under `.features-gen` are intentionally left in place so a
 * developer can re-open them after a failure to inspect the exact step
 * sequence the runner executed.
 */
const TMP_DIR = resolve(process.cwd(), 'tests/e2e/.tmp')

export default function globalTeardown(): void {
  rmSync(TMP_DIR, { recursive: true, force: true })
}
