/**
 * File-format version of a persisted Restorm document.
 *
 * The version describes the DOCUMENT, so it lives at the root of the
 * file — a sibling of `collections:`, next to `_projectUuid` — and never
 * on a collection inside it:
 *
 * ```yaml
 * fileFormatVersion: 1
 * _projectUuid: 8b1f…
 * collections:
 *   - folderType: environment
 *     …
 * ```
 *
 * It used to be stamped on each root `EnvironmentFolder`, which made it
 * per-collection in shape and per-file in intent: a nine-collection file
 * had nine possible carriers, nothing kept them in agreement, and in
 * practice only one was filled. The root is the only placement where the
 * question "what format is this file?" has exactly one answer.
 *
 * **The root is the only place this value is ever read from.** There is
 * deliberately no fallback to the old position, and adding one back would
 * be a regression: a second home for the value that every future reader
 * has to know about, in exchange for nothing.
 *
 * Nothing breaks without that fallback. A version declared nowhere at the
 * root already means SUPPORTED — the long-standing rule for files that
 * predate the field — so a document carrying it on a collection reads as
 * "absent", defaults to the current version, and opens normally. The case
 * a fallback would seem to protect (a FUTURE version on a collection)
 * has no producer: no build writes that position any more, and the builds
 * that did only ever wrote `1`.
 *
 * The stale key on such a document is inert data. It disappears on the
 * next save the user asks for, because the collection model no longer
 * carries the field — not because anything rewrites the file on open.
 *
 * The version exists so that — once Restorm ships to production users —
 * a future breaking change to the on-disk model can migrate forward from
 * the right starting point. The current implementation only establishes
 * the field; no migration framework is wired up yet.
 *
 * Semantics on load:
 * - Declared nowhere (a file predating the field): treat as
 *   {@link CURRENT_FILE_FORMAT_VERSION}, set it in memory, do NOT flag
 *   the document dirty. The next user-initiated save carries it to disk.
 * - Declared at the root and ≤ current: proceed normally.
 * - Declared at the root and > current: the document is REFUSED before it
 *   is loaded — see {@link checkFileFormatCompatibility}. A build cannot
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
 * Name of the top-level key. Shared so the writers that insert it into a
 * document's TEXT (folder mode's root index) spell it the same way the
 * readers here do.
 */
export const FILE_FORMAT_VERSION_KEY = 'fileFormatVersion'

/**
 * Rejection code the main process sends with `file:open-rejected` when a
 * document declares a format this build predates. Shared so the renderer
 * matches on the constant rather than a duplicated string literal.
 */
export const FILE_FORMAT_TOO_NEW_CODE = 'file-format-too-new'

/**
 * Rejection code for a document that declares NO format version at its
 * root. Distinct from {@link FILE_FORMAT_TOO_NEW_CODE} on purpose: telling
 * someone their file "comes from a newer version" when it carries no version
 * at all is a wrong answer, and a wrong answer sends them looking for an
 * update that does not exist.
 */
export const FILE_FORMAT_MISSING_CODE = 'file-format-missing'

interface VersionLogger {
  warn: (message: string, meta?: Record<string, unknown>) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The version an object declares on itself, or `null` when it declares none. */
function declaredOn(node: unknown): number | null {
  if (!isRecord(node)) return null
  const raw = node[FILE_FORMAT_VERSION_KEY]
  // A malformed value is treated as "declares nothing" rather than as a
  // failure: an unreadable version is not evidence of a future format,
  // and refusing on it would turn a typo into "update your Restorm".
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
  return raw
}

/**
 * Outcome of the compatibility gate. `supported: false` means the document
 * must NOT be loaded and the file must NOT be written to.
 */
export interface FileFormatCompatibility {
  /** `false` when the document cannot be read by this build. */
  supported: boolean
  /** Which refusal to report; `null` when the document is supported. */
  code: typeof FILE_FORMAT_TOO_NEW_CODE | typeof FILE_FORMAT_MISSING_CODE | null
  /**
   * The `fileFormatVersion` the document declares AT ITS ROOT — the one
   * place it is read from. `null` when it declares none, which is itself a
   * refusal rather than a value to substitute for.
   */
  found: number | null
  /** The version this build understands — for the user-facing message. */
  current: number
}

/**
 * Decide whether a parsed `.restorm` document can be opened by this build.
 *
 * Deliberately SEPARATE from {@link resolveFileFormatVersion}: resolving
 * answers "which version is this document?" and has no way to say "don't
 * open this at all". This function is pure — it reads, never mutates —
 * so it can run on the raw parsed content BEFORE anything is written to
 * disk, wrapped in a reactive proxy, or published to the renderer.
 *
 * It consults ONE location: the document root. A version sitting anywhere
 * else is not consulted and cannot influence the verdict.
 *
 * A document that declares NO version is refused. Every path that writes a
 * project stamps one, so a missing version means the file came from something
 * other than Restorm — and guessing "it must be current" is how an unrelated
 * YAML file gets loaded as a project and then saved over.
 */
export function checkFileFormatCompatibility(content: unknown): FileFormatCompatibility {
  const declared = declaredOn(content)

  if (declared === null) {
    return { supported: false, code: FILE_FORMAT_MISSING_CODE, found: null, current: CURRENT_FILE_FORMAT_VERSION }
  }
  if (declared > CURRENT_FILE_FORMAT_VERSION) {
    return { supported: false, code: FILE_FORMAT_TOO_NEW_CODE, found: declared, current: CURRENT_FILE_FORMAT_VERSION }
  }
  return { supported: true, code: null, found: declared, current: CURRENT_FILE_FORMAT_VERSION }
}

/**
 * The version a parsed document is loaded AS: its root value, else the
 * current version.
 *
 * Pure. The caller holds the result and writes it back at the root on the
 * next save. A document that declares nothing at the root — whether it
 * predates the field entirely or carries it on a collection — is loaded
 * as current, which is the long-standing rule for a missing version and
 * is what makes a fallback unnecessary.
 */
export function resolveFileFormatVersion(content: unknown, logger: VersionLogger): number {
  const resolved = declaredOn(content) ?? CURRENT_FILE_FORMAT_VERSION

  if (resolved > CURRENT_FILE_FORMAT_VERSION) {
    // Unreachable on every supported load path: `checkFileFormatCompatibility`
    // refuses a future-format document before it reaches here. Reaching
    // this point means a new entry point read a `.restorm` without
    // consulting the gate first — say so loudly rather than proceeding as
    // if the file were current, which is what silently corrupts it on the
    // next save.
    logger.warn('Future fileFormatVersion resolved on load — the compatibility gate was bypassed on this load path.', {
      found: resolved,
      current: CURRENT_FILE_FORMAT_VERSION
    })
  }

  return resolved
}
