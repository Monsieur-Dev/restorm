// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { SettingsProvider } from './SettingsContext'
import type { SettingValue } from '../../types/settings'

const { changeLanguageMock } = vi.hoisted(() => ({ changeLanguageMock: vi.fn() }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en', changeLanguage: changeLanguageMock } })
}))

type SettingChangedListener = (storageKey: string, value: SettingValue) => void

/** Unsubscribe stub for the subscriptions this suite doesn't drive. */
function noop(): void {
  // nothing to tear down
}

const api = {
  settings: {
    getGroups: vi.fn(() => Promise.resolve([])),
    getAll: vi.fn(() => Promise.resolve([])),
    getWorkspacePath: vi.fn(() => Promise.resolve(null)),
    getWorkspaceValues: vi.fn(() => Promise.resolve({})),
    search: vi.fn(() => Promise.resolve([])),
    reindex: vi.fn(() => Promise.resolve(undefined)),
    set: vi.fn(() => Promise.resolve(true)),
    reset: vi.fn(() => Promise.resolve(true)),
    setWorkspaceValue: vi.fn(() => Promise.resolve(true)),
    resetWorkspaceValue: vi.fn(() => Promise.resolve(true)),
    onSettingChanged: vi.fn((listener: SettingChangedListener) => {
      listeners.push(listener)
      return () => {
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
      }
    }),
    onConfigLoaded: vi.fn(() => noop),
    onWorkspaceChanged: vi.fn(() => noop)
  },
  theme: { set: vi.fn(() => Promise.resolve(true)) },
  i18n: { setLanguage: vi.fn(() => Promise.resolve(true)) }
}

const listeners: SettingChangedListener[] = []

beforeEach(() => {
  listeners.length = 0
  vi.clearAllMocks()
  ;(window as unknown as { api: typeof api }).api = api
})

afterEach(() => {
  cleanup()
})

/**
 * The "apply" half of the settings pipeline. These side effects hang off the
 * main-process `settings:changed` broadcast rather than off the settings page's
 * own click handler, which is what lets ANY writer — the settings UI, the
 * workspace overlay, the MCP settings routes — change the theme or the UI
 * language by writing the ordinary setting key.
 */
describe('SettingsProvider — applying a setting change from the main process', () => {
  async function mountAndCaptureListener(): Promise<SettingChangedListener> {
    render(<SettingsProvider>{null}</SettingsProvider>)
    await waitFor(() => { expect(listeners.length).toBeGreaterThan(0) })
    const listener = listeners[0]
    if (!listener) throw new Error('SettingsProvider registered no change listener')
    return listener
  }

  it('applies the theme when the theme setting changes', async () => {
    const notify = await mountAndCaptureListener()

    notify('appearance:theme', 'light/Default Light+')

    expect(api.theme.set).toHaveBeenCalledWith('light/Default Light+')
    expect(api.i18n.setLanguage).not.toHaveBeenCalled()
  })

  it('switches the UI locale when the language setting changes', async () => {
    const notify = await mountAndCaptureListener()

    notify('appearance:language', 'fr')

    // Both halves: the renderer's own i18n instance AND the main-process IPC
    // that persists + reloads the main-side catalogue.
    expect(changeLanguageMock).toHaveBeenCalledWith('fr')
    expect(api.i18n.setLanguage).toHaveBeenCalledWith('fr')
    expect(api.theme.set).not.toHaveBeenCalled()
  })

  it('ignores a setting that carries no side effect', async () => {
    const notify = await mountAndCaptureListener()

    notify('appearance.editor:fontSize', 18)

    expect(api.theme.set).not.toHaveBeenCalled()
    expect(api.i18n.setLanguage).not.toHaveBeenCalled()
    expect(changeLanguageMock).not.toHaveBeenCalled()
  })

  it('ignores a non-string value on a side-effect key', async () => {
    const notify = await mountAndCaptureListener()

    notify('appearance:theme', 42)
    notify('appearance:language', true)

    expect(api.theme.set).not.toHaveBeenCalled()
    expect(api.i18n.setLanguage).not.toHaveBeenCalled()
  })
})
