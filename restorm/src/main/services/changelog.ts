/**
 * Pure CHANGELOG parsing for the post-update "What's new" note. No Electron, no
 * fs — fully unit-testable.
 *
 * Convention: each release is a top-level `## vX.Y.Z` section (a `-preview`/`-rc`
 * suffix on the heading is tolerated). `parseChangelogSince` returns the markdown
 * of the sections released strictly AFTER `fromVersion` and up to and INCLUDING
 * `currentVersion`, preserving file order (newest first).
 *
 * Robustness (per the ticket): `##`/`###` subtitles inside a section and any
 * `## v…`-looking lines inside fenced code blocks must NOT be mistaken for
 * version boundaries.
 */
import {
  compareVersionTuples,
  parseVersionTuple,
  type VersionTuple
} from '../../shared/update/releaseNotes'

/** Match a release heading at line start: `## v1.2.3` (suffix after the patch
 * number is ignored). Capture the dotted core. */
const VERSION_HEADING = /^##\s+v(\d+)\.(\d+)\.(\d+)/

interface Section {
  version: string
  /** major.minor.patch tuple for comparison. */
  tuple: VersionTuple
  /** Full markdown of the section (heading + body), trailing-trimmed. */
  markdown: string
}

/** Split changelog markdown into release sections, ignoring code fences. */
function splitSections(markdown: string): Section[] {
  const lines = markdown.split(/\r?\n/)
  const sections: Section[] = []
  let inFence = false
  let current: { tuple: [number, number, number]; version: string; body: string[] } | null =
    null

  const flush = (): void => {
    if (current) {
      sections.push({
        version: current.version,
        tuple: current.tuple,
        markdown: current.body.join('\n').replace(/\s+$/, '')
      })
    }
  }

  for (const line of lines) {
    // Track fenced code blocks (``` or ~~~) so headings inside them are inert.
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      if (current) current.body.push(line)
      continue
    }

    const heading = !inFence ? VERSION_HEADING.exec(line) : null
    if (heading) {
      flush()
      current = {
        tuple: [Number(heading[1]), Number(heading[2]), Number(heading[3])],
        version: `${heading[1]}.${heading[2]}.${heading[3]}`,
        body: [line]
      }
    } else if (current) {
      current.body.push(line)
    }
    // Lines before the first version heading (preamble/title) are dropped.
  }
  flush()
  return sections
}

/**
 * Split changelog markdown into `{ version, markdown }` sections, newest first
 * (file order), ignoring `## v…` lines inside fenced code blocks. Feeds the
 * release-notes modal, which renders every version rather than a `since` slice.
 *
 * The `tuple` each section carries internally is dropped: it exists only for
 * ordering here, and this result crosses IPC to the renderer, which has no use
 * for it.
 */
export function parseReleaseSections(markdown: string): { version: string; markdown: string }[] {
  return splitSections(markdown).map((s) => ({ version: s.version, markdown: s.markdown }))
}

/**
 * Return the markdown of releases in `(fromVersion, currentVersion]`, newest
 * first, joined by blank lines. Empty string when there is nothing to show or
 * inputs are unparseable.
 */
export function parseChangelogSince(
  markdown: string,
  fromVersion: string,
  currentVersion: string
): string {
  const from = parseVersionTuple(fromVersion)
  const current = parseVersionTuple(currentVersion)
  if (!from || !current) return ''

  const picked = splitSections(markdown).filter(
    (s) => compareVersionTuples(s.tuple, from) > 0 && compareVersionTuples(s.tuple, current) <= 0
  )
  return picked.map((s) => s.markdown).join('\n\n').trim()
}
