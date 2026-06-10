import { describe, it, expect } from 'vitest'
import { isUndoKeyEvent, isRedoKeyEvent } from './undoRedoKeys'

/** Build a minimal KeyboardEvent-like object for the matchers. */
function ev(key: string, mods: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>> = {}): KeyboardEvent {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...mods
  } as KeyboardEvent
}

describe('isUndoKeyEvent', () => {
  it('matches Ctrl+Z (Windows / Linux)', () => {
    expect(isUndoKeyEvent(ev('z', { ctrlKey: true }))).toBe(true)
    expect(isUndoKeyEvent(ev('Z', { ctrlKey: true }))).toBe(true)
  })

  it('matches Cmd+Z (macOS)', () => {
    expect(isUndoKeyEvent(ev('z', { metaKey: true }))).toBe(true)
  })

  it('does not match when Shift is held (that is redo)', () => {
    expect(isUndoKeyEvent(ev('z', { ctrlKey: true, shiftKey: true }))).toBe(false)
  })

  it('does not match Alt+Z or a bare Z', () => {
    expect(isUndoKeyEvent(ev('z', { ctrlKey: true, altKey: true }))).toBe(false)
    expect(isUndoKeyEvent(ev('z'))).toBe(false)
  })
})

describe('isRedoKeyEvent', () => {
  it('matches Ctrl+Y (Windows)', () => {
    expect(isRedoKeyEvent(ev('y', { ctrlKey: true }))).toBe(true)
  })

  it('matches Ctrl+Shift+Z (Linux)', () => {
    expect(isRedoKeyEvent(ev('z', { ctrlKey: true, shiftKey: true }))).toBe(true)
  })

  it('matches Cmd+Shift+Z (macOS)', () => {
    expect(isRedoKeyEvent(ev('z', { metaKey: true, shiftKey: true }))).toBe(true)
  })

  it('does not match Cmd+Y (no redo on macOS via Y)', () => {
    expect(isRedoKeyEvent(ev('y', { metaKey: true }))).toBe(false)
  })

  it('does not match plain Ctrl+Z (that is undo)', () => {
    expect(isRedoKeyEvent(ev('z', { ctrlKey: true }))).toBe(false)
  })
})
