import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  preloadScenarioBreakpoints,
  getScenarioBreakpoints,
  isBreakpointSet,
  hasAnyBreakpoint,
  toggleBreakpoint,
  pruneScenarioBreakpoints,
  _resetScenarioBreakpointCacheForTest
} from './scenarioBreakpointStore'

// Fake `window.api.storage` backed by an in-memory map.
const disk = new Map<string, unknown>()
const storage = {
  get: vi.fn((key: string) => Promise.resolve(disk.get(key))),
  set: vi.fn((key: string, value: unknown) => { disk.set(key, value); return Promise.resolve(true) }),
  delete: vi.fn((key: string) => { disk.delete(key); return Promise.resolve(true) })
}

beforeEach(() => {
  disk.clear()
  storage.get.mockClear(); storage.set.mockClear(); storage.delete.mockClear()
  _resetScenarioBreakpointCacheForTest()
  ;(window as unknown as { api: { storage: typeof storage } }).api = { storage }
})

const P = 'proj-1'
const S = 'scn-1'

describe('scenarioBreakpointStore', () => {
  it('toggles a breakpoint on then off, reflected by the read helpers', async () => {
    await preloadScenarioBreakpoints(P)
    expect(hasAnyBreakpoint(P, S)).toBe(false)

    expect(toggleBreakpoint(P, S, 'n1')).toBe(true)
    expect(isBreakpointSet(P, S, 'n1')).toBe(true)
    expect(hasAnyBreakpoint(P, S)).toBe(true)
    expect([...getScenarioBreakpoints(P, S)]).toEqual(['n1'])

    expect(toggleBreakpoint(P, S, 'n1')).toBe(false)
    expect(isBreakpointSet(P, S, 'n1')).toBe(false)
    expect(hasAnyBreakpoint(P, S)).toBe(false)
  })

  it('getScenarioBreakpoints returns a COPY (mutating it cannot corrupt the store)', async () => {
    await preloadScenarioBreakpoints(P)
    toggleBreakpoint(P, S, 'n1')
    const copy = getScenarioBreakpoints(P, S)
    copy.add('n2')
    expect(isBreakpointSet(P, S, 'n2')).toBe(false)
  })

  it('rehydrates from disk on preload', async () => {
    disk.set('scenario_breakpoints:proj-1', { 'scn-1': ['a', 'b'] })
    await preloadScenarioBreakpoints(P)
    expect([...getScenarioBreakpoints(P, S)].sort()).toEqual(['a', 'b'])
    expect(hasAnyBreakpoint(P, S)).toBe(true)
  })

  it('prunes breakpoints whose node no longer exists (file edited elsewhere) without crashing', async () => {
    disk.set('scenario_breakpoints:proj-1', { 'scn-1': ['keep', 'gone-1', 'gone-2'] })
    await preloadScenarioBreakpoints(P)

    const removed = pruneScenarioBreakpoints(P, S, new Set(['keep', 'other']))
    expect(removed).toBe(true)
    expect([...getScenarioBreakpoints(P, S)]).toEqual(['keep'])

    // Pruning everything clears the scenario entry; a no-op prune returns false.
    expect(pruneScenarioBreakpoints(P, S, new Set(['keep']))).toBe(false)
    expect(pruneScenarioBreakpoints(P, S, new Set())).toBe(true)
    expect(hasAnyBreakpoint(P, S)).toBe(false)
  })

  it('pruning a scenario with no breakpoints is a safe no-op', () => {
    expect(pruneScenarioBreakpoints(P, 'unknown-scn', new Set(['x']))).toBe(false)
  })

  it('persists to disk (debounced) after a toggle', async () => {
    vi.useFakeTimers()
    try {
      await preloadScenarioBreakpoints(P)
      toggleBreakpoint(P, S, 'n1')
      await vi.advanceTimersByTimeAsync(350)
      expect(disk.get('scenario_breakpoints:proj-1')).toEqual({ 'scn-1': ['n1'] })
    } finally {
      vi.useRealTimers()
    }
  })
})
