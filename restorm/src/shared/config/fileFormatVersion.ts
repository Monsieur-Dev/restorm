/**
 * File-format version stamped on the root of every persisted Restorm
 * document (`EnvironmentFolder.fileFormatVersion`).
 *
 * The version exists so that — once Restorm ships to production users —
 * a future breaking change to the on-disk model can migrate forward from
 * the right starting point. This ticket (OYO-200) just establishes the
 * field; no migration framework is introduced yet.
 *
 * Semantics on load:
 * - Field absent (legacy file): treat as {@link CURRENT_FILE_FORMAT_VERSION},
 *   set it in memory, do NOT flag the document dirty. The next
 *   user-initiated save will carry it to disk.
 * - Field present and ≤ current: proceed normally.
 * - Field present and > current: emit a warning, proceed as if it were
 *   the current version (no migration framework yet — a future ticket
 *   introduces the version registry + transformers).
 */

export const CURRENT_FILE_FORMAT_VERSION = 1

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
    logger.warn('Unknown fileFormatVersion — proceeding as current. A future migration registry will replace this path.', {
      found: raw,
      current: CURRENT_FILE_FORMAT_VERSION
    })
    // Leave `raw` in place so future migrations can detect "loaded-from-future".
  }
}
