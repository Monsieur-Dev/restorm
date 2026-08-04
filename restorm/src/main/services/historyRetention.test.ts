import { describe, it, expect, vi, beforeEach } from 'vitest'

const settingsMock = vi.hoisted(() => ({
  initialized: true,
  value: undefined as unknown,
  listeners: new Map<string, (value: unknown) => void>()
}))

vi.mock('electron-core-ui', () => ({
  isSettingsServiceInitialized: (): boolean => settingsMock.initialized,
  getSettingsService: (): {
    get: (key: string) => unknown
    onSettingChanged: (key: string, listener: (value: unknown) => void) => () => void
  } => ({
    get: () => settingsMock.value,
    onSettingChanged: (key, listener) => {
      settingsMock.listeners.set(key, listener)
      return () => { settingsMock.listeners.delete(key) }
    }
  })
}))

const {
  DEFAULT_HISTORY_MAX_ENTRIES,
  HISTORY_MAX_ENTRIES_KEY,
  getHistoryLimit,
  normalizeHistoryLimit,
  onHistoryLimitChanged
} = await import('./historyRetention')

beforeEach(() => {
  settingsMock.initialized = true
  settingsMock.value = undefined
  settingsMock.listeners.clear()
})

describe('normalizeHistoryLimit', () => {
  it('keeps a valid integer as-is', () => {
    expect(normalizeHistoryLimit(25)).toBe(25)
  })

  it('parses a number that round-tripped through a JSON file as a string', () => {
    expect(normalizeHistoryLimit('50')).toBe(50)
  })

  it('floors a fractional value rather than slicing on a non-integer', () => {
    expect(normalizeHistoryLimit(7.9)).toBe(7)
  })

  it('clamps below the declared minimum, so a history can never collapse to nothing', () => {
    expect(normalizeHistoryLimit(0)).toBe(1)
    expect(normalizeHistoryLimit(-10)).toBe(1)
  })

  it('clamps above the declared maximum', () => {
    expect(normalizeHistoryLimit(999999)).toBe(1000)
  })

  it.each([undefined, null, '', '  ', 'abc', NaN, Infinity, {}, []])(
    'falls back to the default for an unusable value (%p)',
    (value) => {
      expect(normalizeHistoryLimit(value)).toBe(DEFAULT_HISTORY_MAX_ENTRIES)
    }
  )
})

describe('getHistoryLimit', () => {
  it('reads the stored setting', () => {
    settingsMock.value = 42
    expect(getHistoryLimit()).toBe(42)
  })

  it('returns the default before the settings service is up', () => {
    settingsMock.initialized = false
    settingsMock.value = 42
    expect(getHistoryLimit()).toBe(DEFAULT_HISTORY_MAX_ENTRIES)
  })

  it('re-reads on every call, so a change needs no restart', () => {
    settingsMock.value = 5
    expect(getHistoryLimit()).toBe(5)
    settingsMock.value = 80
    expect(getHistoryLimit()).toBe(80)
  })
})

describe('onHistoryLimitChanged', () => {
  it('subscribes under the documented storage key', () => {
    onHistoryLimitChanged(() => { /* only the subscription matters here */ })
    expect(settingsMock.listeners.has(HISTORY_MAX_ENTRIES_KEY)).toBe(true)
  })

  it('hands the listener an already-normalized value', () => {
    const seen: number[] = []
    onHistoryLimitChanged((limit) => { seen.push(limit) })
    settingsMock.listeners.get(HISTORY_MAX_ENTRIES_KEY)?.('30')
    settingsMock.listeners.get(HISTORY_MAX_ENTRIES_KEY)?.(0)
    expect(seen).toEqual([30, 1])
  })

  it('unsubscribes', () => {
    const unsubscribe = onHistoryLimitChanged(() => { /* only the subscription matters here */ })
    unsubscribe()
    expect(settingsMock.listeners.has(HISTORY_MAX_ENTRIES_KEY)).toBe(false)
  })

  it('is a safe no-op before the settings service is up', () => {
    settingsMock.initialized = false
    const unsubscribe = onHistoryLimitChanged(() => { /* only the subscription matters here */ })
    expect(settingsMock.listeners.size).toBe(0)
    expect(() => { unsubscribe() }).not.toThrow()
  })

  // The real boot order: the history stores `initialize()` at module scope in
  // `main/index.ts`, before `initializeApp()` stands up SettingsService. A
  // listener registered then must still end up subscribed, or changing the
  // setting would never re-prune anything in the shipped app.
  it('subscribes a listener registered BEFORE the settings service exists, once it appears', async () => {
    vi.useFakeTimers()
    try {
      settingsMock.initialized = false
      const seen: number[] = []
      onHistoryLimitChanged((limit) => { seen.push(limit) })
      expect(settingsMock.listeners.size).toBe(0)

      // SettingsService comes up later in the boot sequence.
      settingsMock.initialized = true
      await vi.advanceTimersByTimeAsync(500)

      expect(settingsMock.listeners.has(HISTORY_MAX_ENTRIES_KEY)).toBe(true)
      settingsMock.listeners.get(HISTORY_MAX_ENTRIES_KEY)?.(3)
      expect(seen).toEqual([3])
    } finally {
      vi.useRealTimers()
    }
  })

  it('a deferred listener can be unsubscribed before the settings service appears', async () => {
    vi.useFakeTimers()
    try {
      settingsMock.initialized = false
      const seen: number[] = []
      const unsubscribe = onHistoryLimitChanged((limit) => { seen.push(limit) })
      unsubscribe()

      settingsMock.initialized = true
      await vi.advanceTimersByTimeAsync(500)

      expect(settingsMock.listeners.size).toBe(0)
      expect(seen).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})
