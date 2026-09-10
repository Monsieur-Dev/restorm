/**
 * Turn a non-fatal import warning into what the user reads beside a
 * successful preview.
 *
 * Same shape and rationale as `importErrorDisplay`: the sentence is ours and
 * fully localised (rendered from the warning `code`), and any spec-local,
 * untranslatable text — the actual broken `$ref` strings, operation paths —
 * sits in its own `detail` slot rather than being interpolated into the
 * sentence. A warning never fails the import; it explains what couldn't be
 * built.
 */

import type { TFunction } from 'i18next'
import {
  IMPORT_WARNING_DETAIL_PARAM,
  type ImportWarningCode,
  type ImportWarningDescriptor
} from '../../../../shared/config/importWarnings'

export interface DisplayedImportWarning {
  /** Translated sentence. Never contains upstream text. */
  message: string
  /** Verbatim upstream text (the specific problems), or `null`. */
  detail: string | null
}

/** Warning code → the translation key that renders it, with the English
 *  source string as the inline default. */
const MESSAGE_BY_CODE: Record<ImportWarningCode, { key: string; fallback: string }> = {
  openApiStructuralIssues: {
    key: 'import.warning.openApiStructuralIssues',
    fallback:
      'The spec imported, but {{count}} part(s) could not be resolved and were skipped (unresolved $refs, request bodies without content). The rest was imported normally.'
  }
}

function normalizeDetail(raw: string | undefined): string | null {
  if (raw === undefined) return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Resolve one warning descriptor to the sentence + detail the user sees. */
export function describeImportWarning(t: TFunction, warning: ImportWarningDescriptor): DisplayedImportWarning {
  const entry = MESSAGE_BY_CODE[warning.code]
  const { [IMPORT_WARNING_DETAIL_PARAM]: detail, ...interpolated } = warning.params
  return {
    message: t(entry.key, entry.fallback, interpolated),
    detail: normalizeDetail(detail)
  }
}
