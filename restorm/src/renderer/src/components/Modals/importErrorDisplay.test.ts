import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInstance, type i18n, type TFunction } from 'i18next'

import { describeImportError, flattenImportError } from './importErrorDisplay'
import { formatImportError, IMPORT_ERROR_CODES } from '../../../../shared/config/importErrors'

/**
 * These tests run against the SHIPPED locale files, not a stub. The
 * defect they guard is invisible to a stubbed `t`: a key that exists in
 * `en` and nowhere else resolves fine in development and silently falls
 * back to English for a user running the app in German or Japanese.
 * Asserting that `fr` and `ja` differ from `en` is what actually proves
 * a translation shipped.
 */
const LOCALES = join(__dirname, '../../../locales')

function loadLocale(code: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(LOCALES, code, 'translation.json'), 'utf8')) as Record<string, unknown>
}

let en: i18n
let fr: i18n
let ja: i18n

function instance(code: string): i18n {
  const created = createInstance({
    lng: code,
    fallbackLng: 'en',
    resources: {
      en: { translation: loadLocale('en') },
      [code]: { translation: loadLocale(code) }
    },
    interpolation: { escapeValue: false }
  })
  void created.init()
  return created
}

beforeAll(() => {
  en = instance('en')
  fr = instance('fr')
  ja = instance('ja')
})

/** Parameters that keep every code's sentence sensible, so one loop can
 *  cover all of them. Extra parameters a code doesn't use are inert. */
const SAMPLE_PARAMS = { format: 'openapi', status: '502', url: 'https://api.example.com/spec' }

describe('describeImportError', () => {
  it('names every failure code in every shipped locale', () => {
    // The loop is over the code list itself, so a code added without a
    // sentence — or with a sentence only in `en` — fails here rather
    // than reaching a user as English in a Japanese UI.
    for (const code of IMPORT_ERROR_CODES) {
      const raw = formatImportError(code, SAMPLE_PARAMS)
      const english = describeImportError(en.t as TFunction, { raw })
      const french = describeImportError(fr.t as TFunction, { raw })
      const japanese = describeImportError(ja.t as TFunction, { raw })

      expect(english.message, code).not.toHaveLength(0)
      expect(english.message, code).not.toContain('import.error')
      expect(french.message, code).not.toBe(english.message)
      expect(japanese.message, code).not.toBe(english.message)
      // A translated sentence must not leave a placeholder unfilled.
      expect(french.message, code).not.toContain('{{')
      expect(japanese.message, code).not.toContain('{{')
    }
  })

  it('interpolates a named failure into the localised sentence', () => {
    const raw = formatImportError('emptySpec', { url: 'https://api.example.com/spec', format: 'openapi' })
    const { message, detail } = describeImportError(fr.t as TFunction, { raw })

    expect(message).toContain('https://api.example.com/spec')
    expect(message).toContain('openapi')
    expect(message).toContain('opération')
    expect(detail).toBeNull()
  })

  it('keeps upstream text out of the translated sentence', () => {
    // The rule the whole module exists for. A YAML parser writes English
    // regardless of the app's locale; folding it into a French sentence
    // produces something worse than either half, and dropping it costs
    // the user the string that makes a bug report actionable.
    const parserMessage = 'Nested mappings are not allowed in compact mappings at line 3, column 5'
    const raw = formatImportError('specParseFailed', { url: 'https://api.example.com/spec', detail: parserMessage })
    const { message, detail } = describeImportError(fr.t as TFunction, { raw })

    expect(message).not.toContain(parserMessage)
    expect(message).not.toContain('Nested mappings')
    expect(message).toContain('https://api.example.com/spec')
    expect(detail).toBe(parserMessage)
  })

  it('frames an unnamed failure and preserves its text verbatim', () => {
    const enoent = "ENOENT: no such file or directory, open '/home/u/spec.yaml'"
    const { message, detail } = describeImportError(fr.t as TFunction, { raw: enoent })

    expect(message).toBe(fr.t('import.error.unexpected'))
    expect(message).not.toBe(en.t('import.error.unexpected'))
    expect(detail).toBe(enoent)
  })

  it('falls back to the generic frame for a code it does not know', () => {
    // A code minted by a newer main process than this renderer. Showing
    // the raw token would be worse than admitting the failure is
    // unexpected, and the token still reaches the user as detail.
    const raw = 'RESTORM_IMPORT_ERR:inventedLater:{"a":"b"}'
    const { message, detail } = describeImportError(fr.t as TFunction, { raw })

    expect(message).toBe(fr.t('import.error.unexpected'))
    expect(detail).toBe(raw)
  })

  it('prefers a structured code over anything in the raw message', () => {
    // The `import:preview` path keeps `error` as English prose for logs
    // and the MCP tools, and carries the identity separately.
    const { message, detail } = describeImportError(fr.t as TFunction, {
      raw: 'Unsupported format: typespec',
      code: 'unsupportedFormat',
      params: { format: 'typespec' }
    })

    expect(message).toBe(fr.t('import.error.unsupportedFormat', { format: 'typespec' }))
    expect(message).toContain('typespec')
    expect(message).not.toContain('Unsupported format')
    expect(detail).toBeNull()
  })

  it('drops a blank detail rather than rendering an empty slot', () => {
    // `response.statusText` is routinely empty on HTTP/2.
    const raw = formatImportError('httpStatus', { status: '502', detail: '   ' })
    expect(describeImportError(fr.t as TFunction, { raw }).detail).toBeNull()
  })

  it('reports nothing at all as an unexpected failure, not as blank', () => {
    const { message, detail } = describeImportError(fr.t as TFunction, {})
    expect(message).toBe(fr.t('import.error.unexpected'))
    expect(detail).toBeNull()
  })
})

describe('flattenImportError', () => {
  it('keeps the detail attached for surfaces that take a single string', () => {
    // The failure toast outlives the modal; dropping the detail there
    // would lose it for a user who dismisses the dialog.
    expect(flattenImportError({ message: 'Échec.', detail: 'ECONNREFUSED' })).toBe('Échec. — ECONNREFUSED')
    expect(flattenImportError({ message: 'Échec.', detail: null })).toBe('Échec.')
  })
})
