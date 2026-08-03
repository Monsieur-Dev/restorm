/**
 * File-format version stamped on the root of every persisted Restorm
 * document (`EnvironmentFolder.fileFormatVersion`).
 *
 * The version exists so that — once Restorm ships to production users —
 * a future breaking change to the on-disk model can migrate forward from
 * the right starting point. The current implementation only establishes
 * the field; no migration framework is wired up yet.
 *
 * Semantics on load:
 * - Field absent (legacy file): treat as {@link CURRENT_FILE_FORMAT_VERSION},
 *   set it in memory, do NOT flag the document dirty. The next
 *   user-initiated save will carry it to disk.
 * - Field present and ≤ current: proceed normally.
 * - Field present and > current: the document is REFUSED before it is
 *   loaded — see {@link checkFileFormatCompatibility}. A build cannot
 *   know what a later format added, so loading such a file would risk a
 *   partial read followed by a save that writes the impoverished
 *   understanding back over the user's data.
 *
 * ## When to bump the version
 *
 * `fileFormatVersion` describes the ON-DISK MODEL, not the application.
 * It is independent of the app's semver: shipping 1.4.0 or 2.0.0 does not
 * move it. Bump it only for a change a previous build cannot read
 * correctly — a field whose meaning changes, a structure that moves, a
 * value whose absence stops being equivalent to its default. Purely
 * additive changes (a new optional field an older build ignores
 * harmlessly) do NOT warrant a bump, because every bump locks existing
 * users out of files made by newer builds until they update.
 */

export const CURRENT_FILE_FORMAT_VERSION = 1

/**
 * Rejection code the main process sends with `file:open-rejected` when a
 * document declares a format this build predates. Shared so the renderer
 * matches on the constant rather than a duplicated string literal.
 */
export const FILE_FORMAT_TOO_NEW_CODE = 'file-format-too-new'

interface MutableRoot {
  folderType?: unknown
  fileFormatVersion?: unknown
}

interface VersionLogger {
  warn: (message: string, meta?: Record<string, unknown>) => void
}

/**
 * Normalize the `fileFormatVersion` of a loaded root EnvironmentFolder
 * plain object in-place. Called on the parsed collection **before**
 * wrapping it in a reactive proxy and **before** the whole-file content
 * checksum baseline is computed — that way the defaulted value is part
 * of the "loaded" snapshot and never looks like a user edit.
 *
 * Intentionally tolerant: unknown shapes, non-env folders, and
 * non-number version values all short-circuit cleanly.
 */
export function normalizeFileFormatVersion(root: unknown, logger: VersionLogger): void {
  if (root === null || typeof root !== 'object' || Array.isArray(root)) return
  const node = root as MutableRoot
  if (node.folderType !== 'environment') return

  const raw = node.fileFormatVersion
  if (raw === undefined || raw === null) {
    node.fileFormatVersion = CURRENT_FILE_FORMAT_VERSION
    return
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    node.fileFormatVersion = CURRENT_FILE_FORMAT_VERSION
    return
  }
  if (raw > CURRENT_FILE_FORMAT_VERSION) {
    // Unreachable on every supported load path: `checkFileFormatCompatibility`
    // refuses a future-format document before it reaches the normalizer.
    // Reaching here means a new entry point reads a `.restorm` without
    // consulting the gate first — say so loudly rather than proceeding as
    // if the file were current, which is what silently corrupts it on the
    // next save. The value is left untouched either way.
    logger.warn('Future fileFormatVersion reached the normalizer — the compatibility gate was bypassed on this load path.', {
      found: raw,
      current: CURRENT_FILE_FORMAT_VERSION
    })
  }
}

/**
 * Outcome of the compatibility gate. `supported: false` means the document
 * must NOT be loaded and the file must NOT be written to.
 */
export interface FileFormatCompatibility {
  /** `false` when the document declares a format this build cannot read. */
  supported: boolean
  /**
   * The highest `fileFormatVersion` declared by any root in the document.
   * Absent / malformed values count as {@link CURRENT_FILE_FORMAT_VERSION},
   * matching `normalizeFileFormatVersion`'s defaulting.
   */
  found: number
  /** The version this build understands — for the user-facing message. */
  current: number
}

/**
 * Decide whether a parsed `.restorm` document can be opened by this build.
 *
 * Deliberately SEPARATE from {@link normalizeFileFormatVersion}: the
 * normalizer repairs a document in place and has no way to say "don't
 * open this at all". This function is pure — it reads, never mutates —
 * so it can run on the raw parsed content BEFORE anything is written to
 * disk, wrapped in a reactive proxy, or published to the renderer.
 *
 * Accepts the whole parsed file (`{ collections: [...] }`, both file mode
 * and folder mode) as well as a bare array of roots. Anything it cannot
 * recognise is reported as supported: an unreadable shape is not this
 * gate's problem, and refusing it here would turn every unrelated parse
 * failure into a misleading "update your Restorm" message.
 */
export function checkFileFormatCompatibility(content: unknown): FileFormatCompatibility {
  const roots = extractRoots(content)

  let found = CURRENT_FILE_FORMAT_VERSION
  for (const root of roots) {
    if (root === null || typeof root !== 'object' || Array.isArray(root)) continue
    const raw = (root as MutableRoot).fileFormatVersion
    // Absent or malformed defaults to current — same rule the normalizer
    // applies, so a legacy file keeps opening silently.
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue
    if (raw > found) found = raw
  }

  return {
    supported: found <= CURRENT_FILE_FORMAT_VERSION,
    found,
    current: CURRENT_FILE_FORMAT_VERSION
  }
}

/** Roots of a parsed document, whatever wrapper the caller happens to hold. */
function extractRoots(content: unknown): unknown[] {
  if (Array.isArray(content)) return content
  if (content === null || typeof content !== 'object') return []
  const collections = (content as { collections?: unknown }).collections
  if (Array.isArray(collections)) return collections
  // A single root handed over on its own (an importer's output, a
  // single-collection document) still has to be checked.
  return [content]
}
