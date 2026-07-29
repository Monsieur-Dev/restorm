/**
 * Pure version helpers shared across main ↔ renderer for the release-notes
 * modal. No Electron/Node imports so every layer can use them.
 *
 * Note there is deliberately no "scrub remote images from the markdown" helper
 * here: release-note images must be self-contained inline `data:` URIs, and that
 * rule is enforced where the markdown is RENDERED (the viewer's
 * `inlineImagesOnly` mode), not by rewriting the source text. A regex over
 * markdown cannot see a reference-style image whose URL is defined elsewhere in
 * the document, so text-level scrubbing would advertise a guarantee it does not
 * hold.
 */
import type { ReleaseNoteSection } from './updateTypes'

/** A `[major, minor, patch]` version tuple. */
export type VersionTuple = [number, number, number]

/** Parse `X.Y.Z` (ignoring any prerelease/build suffix) → tuple, or null. */
export function parseVersionTuple(version: string): VersionTuple | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim())
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** Compare two version tuples: >0 when `a` is newer, <0 when older, 0 equal. */
export function compareVersionTuples(a: VersionTuple, b: VersionTuple): number {
  const [aMajor, aMinor, aPatch] = a
  const [bMajor, bMinor, bPatch] = b
  if (aMajor !== bMajor) return aMajor < bMajor ? -1 : 1
  if (aMinor !== bMinor) return aMinor < bMinor ? -1 : 1
  if (aPatch !== bPatch) return aPatch < bPatch ? -1 : 1
  return 0
}

/**
 * Compare two dotted versions. Returns >0 when `a` is newer than `b`, <0 when
 * older, 0 when equal (or either is unparseable — treated as equal so a bad
 * value never reorders the list).
 */
export function compareVersions(a: string, b: string): number {
  const ta = parseVersionTuple(a)
  const tb = parseVersionTuple(b)
  if (!ta || !tb) return 0
  return compareVersionTuples(ta, tb)
}

/**
 * How many of `sections` are strictly newer than `version`. Used to seed the
 * modal's initial reveal when opened from the update-ready toast: the versions
 * between the target and the currently-installed one show up front, the rest sit
 * behind "show more".
 */
export function countSectionsNewerThan(
  sections: readonly ReleaseNoteSection[],
  version: string
): number {
  return sections.filter((s) => compareVersions(s.version, version) > 0).length
}
