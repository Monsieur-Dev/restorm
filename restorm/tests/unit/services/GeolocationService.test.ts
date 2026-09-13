import { describe, it, expect, vi, beforeEach } from 'vitest'

// Settings + logger + firewall bypass come from the ECUI main barrel.
const settingsState = { value: false as unknown, listeners: new Map<string, (value: unknown) => void>() }
vi.mock('electron-core-ui/main', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
  withFirewallBypass: (fn: () => Promise<unknown>) => fn(),
  getSettingsService: () => ({
    get: () => settingsState.value,
    onSettingChanged: (key: string, listener: (value: unknown) => void) => {
      settingsState.listeners.set(key, listener)
      return () => { settingsState.listeners.delete(key) }
    }
  })
}))
vi.mock('electron', () => ({
  app: { isPackaged: false },
  // The platform probe is never reached by these tests (Linux + fixed/fake sources).
  BrowserWindow: function BrowserWindow(): never { throw new Error('not used') }
}))

import { GeolocationService, type GeoPosition } from '../../../src/main/services/geolocation/GeolocationService'

/** A fake WebContents with a recording-engine-like debugger. */
function fakeView(attachedByEngine = false): { wc: Electron.WebContents; commands: { method: string; params?: unknown }[]; attaches: number; detaches: number } {
  const commands: { method: string; params?: unknown }[] = []
  const state = { attached: attachedByEngine, attaches: 0, detaches: 0, destroyed: false }
  const listeners = new Map<string, (() => void)[]>()
  const dbg = {
    isAttached: () => state.attached,
    attach: () => { state.attached = true; state.attaches += 1 },
    detach: () => { state.attached = false; state.detaches += 1 },
    sendCommand: (method: string, params?: unknown) => { commands.push({ method, params }); return Promise.resolve({}) }
  }
  const wc = {
    debugger: dbg,
    isDestroyed: () => state.destroyed,
    once: (event: string, cb: () => void) => { listeners.set(event, [...(listeners.get(event) ?? []), cb]) },
    on: (event: string, cb: () => void) => { listeners.set(event, [...(listeners.get(event) ?? []), cb]) }
  } as unknown as Electron.WebContents
  return { wc, commands, get attaches() { return state.attaches }, get detaches() { return state.detaches } }
}

const paris: GeoPosition = { latitude: 48.85, longitude: 2.35, accuracy: 120, source: 'geoclue' }

beforeEach(() => {
  settingsState.value = false
  settingsState.listeners.clear()
})

describe('GeolocationService', () => {
  it('does nothing while the privacy setting is off', async () => {
    const resolver = vi.fn(() => Promise.resolve(paris))
    const service = new GeolocationService([resolver], null)
    service.start()
    const view = fakeView()
    service.track(view.wc)
    await new Promise((r) => setTimeout(r, 10))
    expect(resolver).not.toHaveBeenCalled()
    expect(view.commands).toEqual([])
  })

  it('resolves once through the first source that answers and applies the override to every tracked view', async () => {
    const silent = vi.fn(() => Promise.resolve(null))
    const failing = vi.fn(() => Promise.reject(new Error('no bus')))
    const answering = vi.fn(() => Promise.resolve(paris))
    const service = new GeolocationService([silent, failing, answering], null)
    service.start()
    const a = fakeView()
    const b = fakeView()
    service.track(a.wc)
    service.track(b.wc)
    settingsState.value = true
    settingsState.listeners.get('privacy:geolocation')?.(true)
    await new Promise((r) => setTimeout(r, 20))
    expect(answering).toHaveBeenCalledTimes(1)
    for (const view of [a, b]) {
      expect(view.commands).toEqual([{ method: 'Emulation.setGeolocationOverride', params: { latitude: 48.85, longitude: 2.35, accuracy: 120 } }])
      // The service attaches the debugger for the call and gives it back.
      expect(view.attaches).toBe(1)
      expect(view.detaches).toBe(1)
    }
    expect(service.current()).toEqual(paris)
  })

  it('reuses a debugger the recording engine already holds without attaching or detaching', async () => {
    const service = new GeolocationService([() => Promise.resolve(paris)], null)
    service.start()
    settingsState.value = true
    const view = fakeView(true)
    service.track(view.wc)
    await new Promise((r) => setTimeout(r, 20))
    expect(view.commands.map((c) => c.method)).toEqual(['Emulation.setGeolocationOverride'])
    expect(view.attaches).toBe(0)
    expect(view.detaches).toBe(0)
  })

  it('turning the setting off forgets the position and clears the override on every view', async () => {
    const resolver = vi.fn(() => Promise.resolve(paris))
    const service = new GeolocationService([resolver], null)
    service.start()
    settingsState.value = true
    const view = fakeView()
    service.track(view.wc)
    await new Promise((r) => setTimeout(r, 20))
    settingsState.value = false
    settingsState.listeners.get('privacy:geolocation')?.(false)
    await new Promise((r) => setTimeout(r, 20))
    expect(view.commands.map((c) => c.method)).toEqual(['Emulation.setGeolocationOverride', 'Emulation.clearGeolocationOverride'])
    expect(service.current()).toBeNull()
    // Back on: resolved again (the position was forgotten, not cached).
    settingsState.value = true
    settingsState.listeners.get('privacy:geolocation')?.(true)
    await new Promise((r) => setTimeout(r, 20))
    expect(resolver).toHaveBeenCalledTimes(2)
  })

  it('a seeded position (dev/e2e) short-circuits every source', async () => {
    const resolver = vi.fn(() => Promise.resolve(paris))
    const fixed: GeoPosition = { latitude: 1, longitude: 2, accuracy: 3, source: 'fixed' }
    const service = new GeolocationService([resolver], fixed)
    service.start()
    settingsState.value = true
    const view = fakeView()
    service.track(view.wc)
    await new Promise((r) => setTimeout(r, 20))
    expect(resolver).not.toHaveBeenCalled()
    expect(view.commands[0]?.params).toEqual({ latitude: 1, longitude: 2, accuracy: 3 })
  })

  it('re-applies the override when the engine releases the debugger', async () => {
    const service = new GeolocationService([() => Promise.resolve(paris)], null)
    service.start()
    settingsState.value = true
    const view = fakeView()
    service.track(view.wc)
    await new Promise((r) => setTimeout(r, 20))
    service.reapply(view.wc)
    await new Promise((r) => setTimeout(r, 20))
    expect(view.commands.filter((c) => c.method === 'Emulation.setGeolocationOverride')).toHaveLength(2)
  })
})
