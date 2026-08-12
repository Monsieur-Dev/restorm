/**
 * Turn an import / refresh failure into what the user actually reads.
 *
 * Import failures arrive from the main process in two shapes — a
 * structured `{ errorCode, errorParams, error }` result, or a rejected
 * IPC call whose `Error.message` carries the same triple encoded by
 * `formatImportError`. Both collapse here into one pair:
 *
 *   - `message` — always translated, always a complete sentence.
 *   - `detail`  — untranslatable upstream text (a parser's complaint, a
 *     filesystem error, a server's reason phrase), or `null`.
 *
 * The split is the point. Interpolating a parser's English fragment
 * into a French sentence produces something worse than either half; but
 * dropping the fragment costs the user the only string that makes a bug
 * report actionable. So the sentence is ours and fully localised, and
 * the upstream text sits beside it, verbatim and selectable.
 */

import type { TFunction } from 'i18next'
import {
  IMPORT_ERROR_DETAIL_PARAM,
  parseImportError,
  type ImportErrorCode,
  type ImportErrorParams
} from '../../../../shared/config/importErrors'

export interface DisplayedImportError {
  /** Translated sentence. Never contains upstream text. */
  message: string
  /** Verbatim upstream text, or `null` when the failure is fully named. */
  detail: string | null
}

/**
 * Failure code → the translation key that renders it, with the English
 * source string as the inline default.
 */
const MESSAGE_BY_CODE: Record<ImportErrorCode, { key: string; fallback: string }> = {
  folderNotFound: {
    key: 'import.error.folderNotFound',
    fallback: "This folder no longer exists in the project, so it can't be refreshed."
  },
  noSourceUrl: {
    key: 'import.error.noSourceUrl',
    fallback: 'This folder records no source URL, so there is nothing to refresh from.'
  },
  noImportSource: {
    key: 'import.error.noImportSource',
    fallback: "This folder wasn't created by a recognised import, so it can't be refreshed from a source."
  },
  formatNotRefreshable: {
    key: 'import.error.formatNotRefreshable',
    fallback: 'A {{format}} import is one-shot: there is no spec to fetch again, so this folder cannot be refreshed.'
  },
  httpStatus: {
    key: 'import.error.httpStatus',
    fallback: 'The source answered the request with HTTP {{status}}.'
  },
  specParseFailed: {
    key: 'import.error.specParseFailed',
    fallback: 'The spec fetched from {{url}} could not be parsed.'
  },
  sourceImportFailed: {
    key: 'import.error.sourceImportFailed',
    fallback: 'The spec could not be re-imported from its source.'
  },
  emptySpec: {
    key: 'import.error.emptySpec',
    fallback: 'The spec fetched from {{url}} declares no {{format}} operation. Applying it would empty this folder, so the update was refused.'
  },
  formatNotDetected: {
    key: 'import.error.formatNotDetected',
    fallback: 'The format of this source was not recognised.'
  },
  unsupportedFormat: {
    key: 'import.error.unsupportedFormat',
    fallback: 'No importer handles the {{format}} format.'
  },
  projectFormatTooNew: {
    key: 'import.error.projectFormatTooNew',
    fallback: 'This project file uses format version {{found}}, but this version of Restorm only understands version {{current}}. Update Restorm to import it.'
  },
  projectFormatMissing: {
    key: 'import.error.projectFormatMissing',
    fallback: 'This file declares no Restorm format version, so it is not a Restorm project file.'
  }
}

/** Non-empty upstream text, or `null`. Blank strings are dropped so the
 *  detail slot never renders an empty row. */
function normalizeDetail(raw: string | undefined): string | null {
  if (raw === undefined) return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

export interface ImportFailure {
  /** Raw message from the failure — a coded message, an upstream
   *  string, or whatever a rejected promise carried. */
  raw?: string
  /** Code from a structured result, when the handler returned one. */
  code?: string
  /** Parameters accompanying a structured result's code. */
  params?: ImportErrorParams
}

/**
 * Resolve a failure to the sentence + detail the user sees.
 *
 * A structured `code` wins over anything encoded in `raw`; without one,
 * `raw` is decoded, and a message that decodes to nothing falls through
 * to the generic frame with `raw` preserved as the detail.
 *
 * **The two halves must not be merged, in either direction.** Both
 * "simplifications" are tempting and both are wrong:
 *
 * - Interpolating `detail` INTO the sentence reads better in English and
 *   nowhere else. It yields a French sentence wrapped around an English
 *   parser fragment — worse than either half on its own, and it is the
 *   exact defect this module was written to remove.
 * - Dropping `detail` to keep the row tidy costs the user the only
 *   string that makes a bug report actionable. A YAML parser's line and
 *   column, an `ENOENT` with its path, a gRPC status — none of that is
 *   reconstructible from a translated sentence.
 *
 * So the sentence is ours and fully localised, and the upstream text
 * sits beside it, verbatim.
 */
export function describeImportError(t: TFunction, failure: ImportFailure): DisplayedImportError {
  const raw = failure.raw
  const decoded = failure.code !== undefined
    ? { code: failure.code, params: failure.params ?? {} }
    : (raw !== undefined ? parseImportError(raw) : null)

  const entry = decoded !== null
    ? MESSAGE_BY_CODE[decoded.code as ImportErrorCode]
    : undefined

  if (decoded === null || entry === undefined) {
    return {
      message: t('import.error.unexpected', 'The import failed for an unexpected reason.'),
      detail: normalizeDetail(raw)
    }
  }

  // The reserved `detail` parameter is upstream text; it goes to its own
  // slot and is never handed to the interpolator.
  const { [IMPORT_ERROR_DETAIL_PARAM]: detail, ...interpolated } = decoded.params
  return {
    message: t(entry.key, entry.fallback, interpolated),
    detail: normalizeDetail(detail)
  }
}

/**
 * Single-line rendering for surfaces that only accept a string (the
 * failure toast's body). Keeps the detail attached rather than dropping
 * it, since a user who dismisses the modal would otherwise lose it.
 */
export function flattenImportError(displayed: DisplayedImportError): string {
  return displayed.detail === null
    ? displayed.message
    : `${displayed.message} — ${displayed.detail}`
}
