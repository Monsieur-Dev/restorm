/**
 * Node/fs adapter for {@link ConsentStorePort} — the consent audit trail on
 * disk, alongside the firewall's own `state.json`.
 *
 * Both sides are deliberately non-throwing. A read failure means "no trail yet"
 * (the user's actual choice lives in the settings store and is unaffected); a
 * write failure is logged and swallowed, because a read-only or full disk must
 * degrade the audit trail, never break consent resolution on a hot path.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ConsentStorePort } from './ConsentService'

/**
 * Build a {@link ConsentStorePort} over a JSON file at `path` (typically
 * `<userData>/privacy/consent.json`). Parent directories are created on first
 * write.
 */
export function makeConsentFileStore(
  path: string,
  log?: (message: string, fields?: Record<string, unknown>) => void
): ConsentStorePort {
  return {
    read(): string | null {
      try {
        if (!existsSync(path)) return null
        return readFileSync(path, 'utf8')
      } catch (error) {
        log?.('ConsentService: failed to read the consent file', { path, error: String(error) })
        return null
      }
    },
    write(contents: string): void {
      try {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, contents, 'utf8')
      } catch (error) {
        log?.('ConsentService: failed to write the consent file', { path, error: String(error) })
      }
    }
  }
}
