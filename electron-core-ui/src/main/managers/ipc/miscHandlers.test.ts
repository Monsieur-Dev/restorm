import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { StorageService } from '../../services'

type Handler = (event: unknown, ...args: unknown[]) => unknown

const { getLanguageMock, setLanguageMock, reindexSearchMock, settingsInitializedMock, handlers } =
  vi.hoisted(() => ({
    getLanguageMock: vi.fn(() => 'main-process-current-language'),
    setLanguageMock: vi.fn(),
    reindexSearchMock: vi.fn(),
    settingsInitializedMock: vi.fn(() => true),
    handlers: new Map<string, Handler>()
  }))

// validatedHandle registers into the same map as ipcMain.handle so both
// handler flavours are reachable from the tests; the schema argument is
// irrelevant here since handlers are invoked directly with valid payloads.
vi.mock('../../ipc/validate', () => ({
  validatedHandle: vi.fn((channel: string, _schema: unknown, handler: Handler) => {
    handlers.set(channel, handler)
  })
}))

vi.mock('../../services', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  i18nService: { setLanguage: setLanguageMock, getLanguage: getLanguageMock },
  isFeatureServiceInitialized: vi.fn(() => false),
  getFeatureService: vi.fn(),
  eventBusService: { emit: vi.fn(), emitSync: vi.fn() },
  isSettingsServiceInitialized: settingsInitializedMock,
  getSettingsService: vi.fn(() => ({ reindexSearch: reindexSearchMock }))
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Handler) => {
      handlers.set(channel, handler)
    })
  },
  BrowserWindow: { getAllWindows: vi.fn(() => []) }
}))

import { registerMiscHandlers } from './miscHandlers'

function makeStorageService(stored: string | undefined): StorageService {
  return { get: vi.fn(() => stored), set: vi.fn() } as unknown as StorageService
}

describe('i18n:get-language handler', () => {
  beforeEach(() => {
    handlers.clear()
    getLanguageMock.mockClear()
  })

  it('returns the explicitly persisted language when one is stored', () => {
    registerMiscHandlers(makeStorageService('fr'))
    const handler = handlers.get('i18n:get-language')
    expect(handler?.({})).toBe('fr')
  })

  it('returns an empty string — never i18nService.getLanguage()\'s own guess — when nothing is stored', () => {
    // This is the load-bearing behaviour for OS-locale detection: the
    // renderer's initial-language resolution treats a non-empty result as
    // "the user explicitly chose this" and skips its own OS-locale fallback
    // entirely, so leaking i18nService's best-guess active language through
    // this channel would look identical to an explicit choice.
    registerMiscHandlers(makeStorageService(undefined))
    const handler = handlers.get('i18n:get-language')
    expect(handler?.({})).toBe('')
    expect(getLanguageMock).not.toHaveBeenCalled()
  })
})

describe('i18n:set-language handler', () => {
  beforeEach(() => {
    handlers.clear()
    getLanguageMock.mockClear()
    setLanguageMock.mockClear()
    reindexSearchMock.mockClear()
    settingsInitializedMock.mockClear()
    settingsInitializedMock.mockReturnValue(true)
    registerMiscHandlers(makeStorageService(undefined))
  })

  it('rebuilds the settings search index when the active language actually changes', () => {
    // Main's search index is built from `i18nService.t(titleKey)`, so it is
    // stale for the language the renderer just resolved from the OS locale.
    getLanguageMock.mockReturnValue('en')
    const handler = handlers.get('i18n:set-language')

    expect(handler?.({}, ['fr'])).toBe(true)

    expect(setLanguageMock).toHaveBeenCalledWith('fr')
    expect(reindexSearchMock).toHaveBeenCalledTimes(1)
  })

  it('does not rebuild the index when the renderer re-reports the language already active', () => {
    getLanguageMock.mockReturnValue('fr')
    const handler = handlers.get('i18n:set-language')

    handler?.({}, ['fr'])

    expect(setLanguageMock).toHaveBeenCalledWith('fr')
    expect(reindexSearchMock).not.toHaveBeenCalled()
  })

  it('still applies the language when no settings service is initialized', () => {
    settingsInitializedMock.mockReturnValue(false)
    getLanguageMock.mockReturnValue('en')
    const handler = handlers.get('i18n:set-language')

    expect(handler?.({}, ['fr'])).toBe(true)

    expect(setLanguageMock).toHaveBeenCalledWith('fr')
    expect(reindexSearchMock).not.toHaveBeenCalled()
  })
})
