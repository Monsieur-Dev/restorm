import { describe, it, expect, vi } from 'vitest'

// LoggerService pulls in the winston main-process logger; stub it so the
// service can be exercised in a plain unit test without a real Electron app.
vi.mock('./LoggerService', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

// StorageService is only touched by initialize()/setLanguage(); t() never
// needs it. Stub it defensively so importing the module is side-effect-free.
vi.mock('./StorageService', () => ({
  getStorageService: () => ({
    get: vi.fn(() => undefined),
    set: vi.fn()
  })
}))

import { i18nService } from './I18nService'

describe('I18nService.t interpolation', () => {
  // The service defaults to currentLanguage='en'; addTranslations() seeds
  // resources without needing initialize(), so t() is exercisable directly.

  it('inserts a parameter value that contains regex/replacement metacharacters literally', () => {
    // The previous implementation built `new RegExp('{{key}}')` and fed the
    // raw param value to String.replace, so a value like '$&' / '$1' was
    // treated as a replacement-pattern special and corrupted the output.
    // split/join inserts the exact string.
    i18nService.addTranslations('en', {
      meta: { greeting: 'Hello {{name}}!' }
    })

    expect(i18nService.t('meta.greeting', { name: '$&' })).toBe('Hello $&!')
    expect(i18nService.t('meta.greeting', { name: '$1 and $`' })).toBe('Hello $1 and $`!')
  })

  it('replaces every occurrence of a repeated token', () => {
    i18nService.addTranslations('en', {
      meta: { repeated: '{{x}}-{{x}}-{{x}}' }
    })

    expect(i18nService.t('meta.repeated', { x: 'A' })).toBe('A-A-A')
  })

  it('does not treat a param key that contains regex metacharacters as a pattern', () => {
    // A key with '.' / '*' would, as a regex source, match more than the
    // literal token. The literal split must only replace the exact `{{a.b}}`.
    i18nService.addTranslations('en', {
      meta: { weird: '{{a.b}} stays, a_b should not change' }
    })

    expect(i18nService.t('meta.weird', { 'a.b': 'X' })).toBe('X stays, a_b should not change')
  })

  it('returns the value untouched when no params are supplied', () => {
    i18nService.addTranslations('en', {
      meta: { plain: 'no {{token}} replaced' }
    })

    expect(i18nService.t('meta.plain')).toBe('no {{token}} replaced')
  })
})

describe('I18nService.getFixedT', () => {
  it('resolves against the GIVEN language, independent of currentLanguage', () => {
    i18nService.addTranslations('en', { fixed: { greeting: 'Hello {{name}}' } })
    i18nService.addTranslations('fr', { fixed: { greeting: 'Bonjour {{name}}' } })
    // getLanguage()/setLanguage() are untouched — no side effect on the
    // app's active UI language just from asking for a fixed translator.
    const currentBefore = i18nService.getLanguage()

    const fixedFr = i18nService.getFixedT('fr')
    expect(fixedFr('fixed.greeting', { name: 'Yoann' })).toBe('Bonjour Yoann')
    expect(i18nService.getLanguage()).toBe(currentBefore)
  })

  it('falls back to the service fallback language for a key missing in the fixed language', () => {
    i18nService.addTranslations('en', { fixed: { onlyInEnglish: 'English only' } })
    const fixedFr = i18nService.getFixedT('fr')
    expect(fixedFr('fixed.onlyInEnglish')).toBe('English only')
  })

  it('resolves an i18next-style plural-suffixed key from a `count` param (matches the renderer i18next convention)', () => {
    i18nService.addTranslations('en', {
      fixed: { countRequest_one: '{{count}} request', countRequest_other: '{{count}} requests' }
    })
    const fixedEn = i18nService.getFixedT('en')
    expect(fixedEn('fixed.countRequest', { count: 1 })).toBe('1 request')
    expect(fixedEn('fixed.countRequest', { count: 3 })).toBe('3 requests')
  })
})
