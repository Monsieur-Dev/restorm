// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

interface WindowWithApi {
  api?: {
    i18n?: {
      getLanguage?: () => Promise<string>
      setLanguage?: (lng: string) => Promise<boolean>
    }
  }
}

function stubWindowApi(getLanguage: () => Promise<string>): void {
  ;(window as unknown as WindowWithApi).api = {
    i18n: {
      getLanguage,
      setLanguage: vi.fn().mockResolvedValue(true)
    }
  }
}

function stubNavigatorLanguages(language: string, languages: readonly string[] = [language]): void {
  Object.defineProperty(window.navigator, 'language', { value: language, configurable: true })
  Object.defineProperty(window.navigator, 'languages', { value: languages, configurable: true })
}

describe('initializeI18n — initial language resolution', () => {
  beforeEach(() => {
    vi.resetModules()
    delete (window as unknown as WindowWithApi).api
  })

  afterEach(() => {
    Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true })
    Object.defineProperty(window.navigator, 'languages', { value: ['en-US'], configurable: true })
  })

  it('honours an explicitly stored language over the OS locale', async () => {
    stubWindowApi(() => Promise.resolve('fr'))
    stubNavigatorLanguages('de-DE')

    const { initializeI18n } = await import('./i18n')
    const instance = await initializeI18n({})

    expect(instance.language).toBe('fr')
  })

  it('falls back to navigator.language matched against the shipped languages when nothing is stored', async () => {
    stubWindowApi(() => Promise.resolve(''))
    stubNavigatorLanguages('fr-FR')

    const { initializeI18n } = await import('./i18n')
    const instance = await initializeI18n({})

    expect(instance.language).toBe('fr')
  })

  it('tries navigator.languages in preference order, skipping unsupported entries', async () => {
    stubWindowApi(() => Promise.resolve(''))
    stubNavigatorLanguages('xx-XX', ['xx-XX', 'de-DE'])

    const { initializeI18n } = await import('./i18n')
    const instance = await initializeI18n({})

    expect(instance.language).toBe('de')
  })

  it('falls back to the caller default when no OS-locale candidate is shipped', async () => {
    stubWindowApi(() => Promise.resolve(''))
    stubNavigatorLanguages('xx-XX')

    const { initializeI18n } = await import('./i18n')
    const instance = await initializeI18n({}, 'en')

    expect(instance.language).toBe('en')
  })

  it('still resolves an OS-locale default when window.api is entirely unavailable', async () => {
    stubNavigatorLanguages('fr-FR')

    const { initializeI18n } = await import('./i18n')
    const instance = await initializeI18n({})

    expect(instance.language).toBe('fr')
  })

  it('persists the OS-locale guess back to main so the next boot reads it as the stored choice', async () => {
    stubWindowApi(() => Promise.resolve(''))
    stubNavigatorLanguages('fr-FR')

    const { initializeI18n } = await import('./i18n')
    await initializeI18n({})

    const setLanguage = (window as unknown as WindowWithApi).api?.i18n?.setLanguage
    expect(setLanguage).toHaveBeenCalledWith('fr')
  })

  it('ignores an unsupported stored value and falls back to the OS locale instead of the default', async () => {
    stubWindowApi(() => Promise.resolve('xx-XX'))
    stubNavigatorLanguages('de-DE')

    const { initializeI18n } = await import('./i18n')
    const instance = await initializeI18n({}, 'en')

    expect(instance.language).toBe('de')
  })
})
