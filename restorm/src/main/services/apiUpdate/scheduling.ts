import { API_UPDATE_INTERVAL_MS, type ApiUpdateConfig } from '../../../shared/types/baseTypes'

/**
 * Pure tick-decision helper extracted from `ApiUpdateScheduler` so
 * the timing logic can be unit-tested without spinning up a real
 * timer or reaching into a folder-registry singleton.
 *
 * Returns `true` when the folder is "due" for a fresh check given
 * the current epoch ms `now`. A folder is due when:
 *
 * - `apiUpdate` is configured and `autoCheckEnabled` is `true`,
 * - the chosen `interval` is not `'never'`,
 * - `lastCheckedAt + intervalMs <= now` (or `lastCheckedAt` is
 *   absent, meaning no check has ever run).
 */
export function isApiUpdateDue(config: ApiUpdateConfig | undefined, now: number): boolean {
  if (!config) return false
  if (!config.autoCheckEnabled) return false
  if (config.interval === 'never') return false
  const intervalMs = API_UPDATE_INTERVAL_MS[config.interval]
  if (!Number.isFinite(intervalMs)) return false
  if (config.lastCheckedAt === undefined) return true
  return config.lastCheckedAt + intervalMs <= now
}

/**
 * Decide whether the latest fetch surfaced a change worth notifying
 * the user about. The checker compares both the spec version
 * (`info.version` etc.) and a structured content hash against the
 * persisted `lastImportedSpec*` markers, so a spec author bumping
 * `info.version` without changing operations OR shipping changes
 * without bumping the version both surface as "available".
 */
export interface CompareSpecsInput {
  fetchedVersion?: string
  fetchedHash: string
  storedVersion?: string
  storedHash?: string
}

export type CompareSpecsResult =
  | { status: 'firstCheck' }
  | { status: 'unchanged' }
  | { status: 'updateAvailable'; reason: 'version' | 'hash' | 'both' }

export function compareSpecAgainstStored(input: CompareSpecsInput): CompareSpecsResult {
  if (input.storedHash === undefined && input.storedVersion === undefined) {
    return { status: 'firstCheck' }
  }
  const versionChanged = input.fetchedVersion !== undefined
    && input.storedVersion !== undefined
    && input.fetchedVersion !== input.storedVersion
  const hashChanged = input.storedHash !== undefined && input.fetchedHash !== input.storedHash
  if (versionChanged && hashChanged) return { status: 'updateAvailable', reason: 'both' }
  if (versionChanged) return { status: 'updateAvailable', reason: 'version' }
  if (hashChanged) return { status: 'updateAvailable', reason: 'hash' }
  return { status: 'unchanged' }
}

/**
 * Resolve `${VAR}` references inside a string against the env
 * folder's variable map. Used by the checker to expand the
 * `sourceUrl` / `sourceHeaders` config — a user's stored token
 * stays in the env vars, never on disk in plain text.
 *
 * Unknown variables are left as-is so the user gets a helpful
 * URL-fetch failure with the unresolved placeholder rather than a
 * silent empty string.
 */
export function expandVariables(template: string, vars: Record<string, string>): string {
  return template.replace(/\$\{([^}]+)\}/g, (match, name: string) => vars[name] ?? match)
}

/**
 * Apply `${VAR}` substitution to every header value before passing
 * the map to `fetch`. Header keys are not substituted (the keys are
 * the canonical form on disk).
 */
export function expandHeaderTemplate(
  headers: Record<string, string> | undefined,
  vars: Record<string, string>
): Record<string, string> {
  if (!headers) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    out[key] = expandVariables(value, vars)
  }
  return out
}
