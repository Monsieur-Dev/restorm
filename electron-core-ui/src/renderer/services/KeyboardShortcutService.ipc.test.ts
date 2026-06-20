// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

import { keyboardShortcutService } from './KeyboardShortcutService'

/**
 * Models the preload bridge: onKeyboardShortcut registers a listener and
 * returns a disposer that removes it. We track live subscriptions so the test
 * can assert that stopListening tore the IPC listener down and that a later
 * re-register does not stack a second one.
 */
function installElectronApiMock(): {
  fire: (shortcut: string) => void
  liveCount: () => number
} {
  const callbacks = new Set<(shortcut: string) => void>()
  ;(window as unknown as { electronAPI?: unknown }).electronAPI = {
    onKeyboardShortcut: (cb: (shortcut: string) => void): (() => void) => {
      callbacks.add(cb)
      return () => callbacks.delete(cb)
    },
    registerInterceptedShortcuts: vi.fn(),
    isDevMode: () => Promise.resolve(false)
  }
  return {
    fire: (shortcut: string) => {
      for (const cb of callbacks) cb(shortcut)
    },
    liveCount: () => callbacks.size
  }
}

describe('KeyboardShortcutService — IPC listener lifecycle (no multi-fire)', () => {
  beforeEach(() => {
    keyboardShortcutService.clearAll()
  })
  afterEach(() => {
    keyboardShortcutService.clearAll()
    delete (window as unknown as { electronAPI?: unknown }).electronAPI
  })

  it('subscribes exactly once and tears the IPC listener down on stopListening', () => {
    const api = installElectronApiMock()

    // Registering the first shortcut auto-starts listening → one IPC sub.
    const dispose = keyboardShortcutService.register('Ctrl+K', vi.fn())
    expect(api.liveCount()).toBe(1)

    // Unregistering the last shortcut auto-stops listening → IPC sub removed.
    dispose()
    expect(api.liveCount()).toBe(0)
  })

  it('does not stack duplicate IPC listeners across stop/restart cycles', () => {
    const api = installElectronApiMock()

    const d1 = keyboardShortcutService.register('Ctrl+K', vi.fn())
    d1() // stops listening, disposes IPC sub
    expect(api.liveCount()).toBe(0)

    // Re-register: previously ipcListenerRegistered stayed true so this path
    // re-subscribed without the latch reset, leaving TWO live listeners.
    keyboardShortcutService.register('Ctrl+J', vi.fn())
    expect(api.liveCount()).toBe(1)
  })

  it('fires a handler exactly once per IPC shortcut after a restart cycle', () => {
    const api = installElectronApiMock()
    const handler = vi.fn()

    const d1 = keyboardShortcutService.register('Ctrl+K', vi.fn())
    d1()
    keyboardShortcutService.register('Ctrl+K', handler)

    api.fire('ctrl+k')
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
