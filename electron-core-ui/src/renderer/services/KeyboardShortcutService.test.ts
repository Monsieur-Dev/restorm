import { describe, it, expect, vi } from 'vitest'

vi.mock('./logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

import { parseShortcut, matchesShortcut } from './KeyboardShortcutService'

/** Build the minimal KeyboardEvent shape the matcher reads. */
function evt(
  key: string,
  mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}
): KeyboardEvent {
  return {
    key,
    ctrlKey: mods.ctrlKey ?? false,
    metaKey: mods.metaKey ?? false,
    altKey: mods.altKey ?? false,
    shiftKey: mods.shiftKey ?? false
  } as KeyboardEvent
}

describe('parseShortcut', () => {
  it('maps ctrl/control to ctrl and cmd/command/meta to meta — distinctly', () => {
    expect(parseShortcut('Ctrl+S')).toMatchObject({ ctrl: true, meta: false, key: 's' })
    expect(parseShortcut('Cmd+S')).toMatchObject({ ctrl: false, meta: true, key: 's' })
    expect(parseShortcut('Meta+S')).toMatchObject({ ctrl: false, meta: true, key: 's' })
  })
})

describe('matchesShortcut — ctrl and meta are distinct', () => {
  it('a Ctrl shortcut matches only ctrlKey, not metaKey', () => {
    const parsed = parseShortcut('Ctrl+S')
    expect(matchesShortcut(evt('s', { ctrlKey: true }), parsed)).toBe(true)
    // Previously `parsed.ctrl !== (ctrlKey || metaKey)` made a lone Cmd press
    // satisfy a Ctrl shortcut — it must not.
    expect(matchesShortcut(evt('s', { metaKey: true }), parsed)).toBe(false)
  })

  it('a Cmd/Meta shortcut matches only metaKey, not ctrlKey', () => {
    const parsed = parseShortcut('Cmd+S')
    expect(matchesShortcut(evt('s', { metaKey: true }), parsed)).toBe(true)
    // The old conflation made a Cmd shortcut never fire when metaKey was set
    // (the ctrl check rejected it). It must fire on metaKey and reject ctrlKey.
    expect(matchesShortcut(evt('s', { ctrlKey: true }), parsed)).toBe(false)
  })

  it('rejects when an extra modifier is held', () => {
    const parsed = parseShortcut('Ctrl+S')
    expect(matchesShortcut(evt('s', { ctrlKey: true, shiftKey: true }), parsed)).toBe(false)
    expect(matchesShortcut(evt('s', { ctrlKey: true, metaKey: true }), parsed)).toBe(false)
  })

  it('matches alt and shift modifiers exactly', () => {
    const parsed = parseShortcut('Alt+Shift+F4')
    expect(matchesShortcut(evt('f4', { altKey: true, shiftKey: true }), parsed)).toBe(true)
    expect(matchesShortcut(evt('f4', { altKey: true }), parsed)).toBe(false)
  })
})
