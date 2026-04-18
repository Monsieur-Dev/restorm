import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  buildInitialWidths,
  clampWidth,
  loadFromStorage,
  storageKey,
  type WidthColumnDef
} from './useColumnWidths'

// JSDOM-free localStorage shim — enough to exercise the persistence logic.
function makeLocalStorage(): Storage {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => { store.clear() },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size }
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', makeLocalStorage())
})

describe('storageKey', () => {
  it('namespaces under ecu:table:<id>:column-widths', () => {
    expect(storageKey('env-favorites')).toBe('ecu:table:env-favorites:column-widths')
  })
})

describe('clampWidth', () => {
  it('clamps below min', () => {
    expect(clampWidth(10, 40, undefined)).toBe(40)
  })
  it('clamps above max', () => {
    expect(clampWidth(500, 40, 300)).toBe(300)
  })
  it('returns value inside range', () => {
    expect(clampWidth(100, 40, 300)).toBe(100)
  })
  it('is unbounded above when max is undefined', () => {
    expect(clampWidth(10000, 40, undefined)).toBe(10000)
  })
})

describe('loadFromStorage', () => {
  it('returns null when key is missing', () => {
    expect(loadFromStorage('nope')).toBeNull()
  })

  it('returns parsed widths for valid payload', () => {
    localStorage.setItem(storageKey('t1'), JSON.stringify({ a: 100, b: 200 }))
    expect(loadFromStorage('t1')).toEqual({ a: 100, b: 200 })
  })

  it('returns null for invalid JSON', () => {
    localStorage.setItem(storageKey('t1'), '{invalid}')
    expect(loadFromStorage('t1')).toBeNull()
  })

  it('returns null for non-object (array) payloads', () => {
    localStorage.setItem(storageKey('t1'), '[1,2,3]')
    expect(loadFromStorage('t1')).toBeNull()
  })

  it('filters out non-finite / non-positive values', () => {
    localStorage.setItem(storageKey('t1'), JSON.stringify({
      good: 100,
      zero: 0,
      negative: -10,
      stringy: '200',
      nan: NaN,
      inf: Infinity
    }))
    expect(loadFromStorage('t1')).toEqual({ good: 100 })
  })
})

describe('buildInitialWidths', () => {
  it('applies fixed width for columns with width prop', () => {
    const columns: WidthColumnDef[] = [
      { id: 'a', width: 25 },
      { id: 'b', width: 30 }
    ]
    expect(buildInitialWidths(columns, null)).toEqual({ a: 25, b: 30 })
  })

  it('applies defaultWidth for resizable columns without persisted value', () => {
    const columns: WidthColumnDef[] = [
      { id: 'key', resizable: true, defaultWidth: 200 },
      { id: 'value', resizable: true, defaultWidth: 300 }
    ]
    expect(buildInitialWidths(columns, null)).toEqual({ key: 200, value: 300 })
  })

  it('leaves resizable columns without defaultWidth as undefined', () => {
    const columns: WidthColumnDef[] = [
      { id: 'a', resizable: true },
      { id: 'b', resizable: true }
    ]
    expect(buildInitialWidths(columns, null)).toEqual({ a: undefined, b: undefined })
  })

  it('merges persisted values, preferring storage over defaults', () => {
    const columns: WidthColumnDef[] = [
      { id: 'key', resizable: true, defaultWidth: 200 },
      { id: 'value', resizable: true, defaultWidth: 300 }
    ]
    expect(buildInitialWidths(columns, { key: 250 })).toEqual({ key: 250, value: 300 })
  })

  it('ignores stale entries for columns that no longer exist', () => {
    const columns: WidthColumnDef[] = [
      { id: 'key', resizable: true, defaultWidth: 200 }
    ]
    const out = buildInitialWidths(columns, { key: 250, removed: 999 })
    expect(out).toEqual({ key: 250 })
    expect(Object.keys(out)).not.toContain('removed')
  })

  it('clamps persisted values to minWidth / maxWidth', () => {
    const columns: WidthColumnDef[] = [
      { id: 'a', resizable: true, defaultWidth: 100, minWidth: 80, maxWidth: 400 }
    ]
    expect(buildInitialWidths(columns, { a: 10 })).toEqual({ a: 80 })
    expect(buildInitialWidths(columns, { a: 9000 })).toEqual({ a: 400 })
  })

  it('keeps fixed-width columns fixed even when persisted value is present', () => {
    // Width-fixed columns are not meant to be persisted, but if something
    // corrupt ends up in storage, the `width` prop always wins.
    const columns: WidthColumnDef[] = [
      { id: 'checkbox', width: 25 }
    ]
    expect(buildInitialWidths(columns, { checkbox: 999 })).toEqual({ checkbox: 25 })
  })
})
