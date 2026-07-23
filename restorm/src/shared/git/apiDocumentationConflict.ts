import type { ApiDocumentation } from '../types/apiDocumentation'

/** Commit timestamps (Unix seconds) for the two sides of the conflict —
 * `window.api.git.getConflictCommitTimestamps`'s result, threaded down
 * from `useGitPullConflict`. */
export interface ApiDocumentationCommitTimestamps {
  ours: number | null
  theirs: number | null
}

/**
 * Dotted-numeric version compare (`"1.2.3"` vs `"1.2.10"` — NOT a
 * lexicographic string compare, which would wrongly rank `"1.2.10"` below
 * `"1.2.9"`). Returns `1`/`-1`/`0`, or `null` when either side is missing
 * or isn't dotted-numeric (e.g. `"1.2.3-beta"`) — the caller falls back to
 * the commit-timestamp tie-breaker in that case rather than guessing at a
 * semver pre-release ordering.
 */
function compareVersions(a: string | undefined, b: string | undefined): number | null {
  if (!a || !b) return null
  const partsA = a.split('.').map(Number)
  const partsB = b.split('.').map(Number)
  if (partsA.some(Number.isNaN) || partsB.some(Number.isNaN)) return null
  const length = Math.max(partsA.length, partsB.length)
  for (let i = 0; i < length; i++) {
    const na = partsA[i] ?? 0
    const nb = partsB[i] ?? 0
    if (na !== nb) return na > nb ? 1 : -1
  }
  return 0
}

/**
 * AC#6: an API-documentation conflict never surfaces as a manual pick —
 * it auto-resolves using the in-YAML API version number (`api.version`),
 * preferring the highest/newest; when versions are equal or absent (or
 * not dotted-numeric), falls back to whichever side's commit is newer.
 * With no confident signal either way, keeps `ours` — a stable default
 * that never surfaces as a "lost my pick" surprise, since `ours` is what
 * the resolved panel already started from.
 */
export function resolveApiDocumentationConflict(
  ours: ApiDocumentation | undefined,
  theirs: ApiDocumentation | undefined,
  commitTimestamps?: ApiDocumentationCommitTimestamps
): ApiDocumentation | undefined {
  if (!ours) return theirs
  if (!theirs) return ours

  const versionComparison = compareVersions(ours.api.version, theirs.api.version)
  if (versionComparison !== null && versionComparison !== 0) {
    return versionComparison > 0 ? ours : theirs
  }

  const oursTime = commitTimestamps?.ours
  const theirsTime = commitTimestamps?.theirs
  if (oursTime != null && theirsTime != null && oursTime !== theirsTime) {
    return oursTime > theirsTime ? ours : theirs
  }

  return ours
}
