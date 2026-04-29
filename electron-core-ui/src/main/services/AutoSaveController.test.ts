import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Stub electron + the LoggerService barrel so the controller imports
// without dragging in an Electron `app` reference (LoggerService reads
// `app.isPackaged` at module init).
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: (): unknown[] => []
  }
}))
vi.mock('./LoggerService', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

import { AutoSaveController, type AutoSaveMode } from './AutoSaveController'
import type { FileService } from './FileService'
import type { SettingsService, SettingChangedListener } from './SettingsService'

// ── Fakes ────────────────────────────────────────────────────────────

interface FakeSettings {
  service: SettingsService
  set: (key: string, value: unknown) => void
}

function makeFakeSettings(initial: Record<string, unknown>): FakeSettings {
  const values = new Map<string, unknown>(Object.entries(initial))
  const listeners = new Map<string, Set<SettingChangedListener>>()

  const service: Partial<SettingsService> = {
    get: ((key: string) => values.get(key)) as SettingsService['get'],
    onSettingChanged: ((key: string, cb: SettingChangedListener) => {
      let bucket = listeners.get(key)
      if (!bucket) {
        bucket = new Set()
        listeners.set(key, bucket)
      }
      bucket.add(cb)
      return () => {
        bucket.delete(cb)
      }
    }) as SettingsService['onSettingChanged']
  }

  return {
    service: service as SettingsService,
    set: (key, value) => {
      values.set(key, value)
      listeners.get(key)?.forEach((cb) => {
        cb(value as never)
      })
    }
  }
}

interface FakeFile {
  service: FileService
  setDirty: (dirty: boolean) => void
  setFilePath: (path: string | null) => void
  /** Fire a synthetic state-changed event, mirroring `FileService.onStateChanged`. */
  emitStateChanged: () => void
}

function makeFakeFile(initialDirty: boolean, initialPath: string | null = '/tmp/file.restorm'): FakeFile {
  let dirty = initialDirty
  let path: string | null = initialPath
  const dirtyCallbacks = new Set<(d: boolean) => void>()
  const stateCallbacks = new Set<(state: { currentFile: { path: string | null } }) => void>()
  const service: Partial<FileService> = {
    getSaveUnitsSnapshot: (() => ({
      isDirty: dirty,
      dirtyCount: dirty ? 1 : 0,
      dirtyUnits: []
    })) as FileService['getSaveUnitsSnapshot'],
    onDirtyChanged: ((cb: (d: boolean) => void) => {
      dirtyCallbacks.add(cb)
      return () => {
        dirtyCallbacks.delete(cb)
      }
    }) as FileService['onDirtyChanged'],
    getFilePath: (() => path) as FileService['getFilePath'],
    onStateChanged: ((cb: (state: { currentFile: { path: string | null } }) => void) => {
      stateCallbacks.add(cb)
      return () => {
        stateCallbacks.delete(cb)
      }
    }) as unknown as FileService['onStateChanged']
  }
  return {
    service: service as FileService,
    setDirty: (d) => {
      dirty = d
      for (const cb of dirtyCallbacks) cb(d)
    },
    setFilePath: (p) => {
      path = p
    },
    emitStateChanged: () => {
      const state = { currentFile: { path } }
      for (const cb of stateCallbacks) cb(state)
    }
  }
}

interface FakeWindow {
  // Subset of BrowserWindow we use; tests can drive blur.
  emitBlur: () => void
  destroyed: boolean
}

function makeFakeWindow(): { window: FakeWindow; asElectron: import('electron').BrowserWindow } {
  const handlers: Record<string, Set<() => void>> = {}
  const w: FakeWindow = {
    emitBlur: () => {
      handlers['blur']?.forEach((h) => {
        h()
      })
    },
    destroyed: false
  }
  const asElectron = {
    on: (event: string, handler: () => void) => {
      let bucket = handlers[event]
      if (!bucket) { bucket = new Set(); handlers[event] = bucket }
      bucket.add(handler)
    },
    removeListener: (event: string, handler: () => void) => {
      handlers[event]?.delete(handler)
    },
    isDestroyed: () => w.destroyed
  } as unknown as import('electron').BrowserWindow
  return { window: w, asElectron }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('AutoSaveController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('off mode: no save no matter how many dirty events arrive', () => {
    const settings = makeFakeSettings({ 'files:autoSave': 'off', 'files:autoSaveDelay': 1000 })
    const file = makeFakeFile(false)
    const trigger = vi.fn()

    const c = new AutoSaveController({
      settings: settings.service,
      fileService: file.service,
      triggerSaveAll: trigger,
      getWindows: () => []
    })
    c.start()

    file.setDirty(true)
    vi.advanceTimersByTime(5000)
    file.setDirty(false)
    file.setDirty(true)
    vi.advanceTimersByTime(5000)

    expect(trigger).not.toHaveBeenCalled()
    c.stop()
  })

  it('afterDelay: dirty -> wait -> save fires exactly once', () => {
    const settings = makeFakeSettings({ 'files:autoSave': 'afterDelay', 'files:autoSaveDelay': 1000 })
    const file = makeFakeFile(false)
    const trigger = vi.fn()
    const c = new AutoSaveController({
      settings: settings.service,
      fileService: file.service,
      triggerSaveAll: trigger,
      getWindows: () => []
    })
    c.start()

    file.setDirty(true)
    vi.advanceTimersByTime(999)
    expect(trigger).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(trigger).toHaveBeenCalledTimes(1)
    c.stop()
  })

  it('afterDelay: bursts of dirty events collapse into a single save', () => {
    const settings = makeFakeSettings({ 'files:autoSave': 'afterDelay', 'files:autoSaveDelay': 500 })
    const file = makeFakeFile(false)
    const trigger = vi.fn()
    const c = new AutoSaveController({
      settings: settings.service,
      fileService: file.service,
      triggerSaveAll: trigger,
      getWindows: () => []
    })
    c.start()

    // Repeated dirty=true within the window resets the timer.
    file.setDirty(true)
    vi.advanceTimersByTime(300)
    file.setDirty(true) // still dirty, fires onDirtyChanged again
    vi.advanceTimersByTime(300)
    file.setDirty(true)
    vi.advanceTimersByTime(499)
    expect(trigger).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(trigger).toHaveBeenCalledTimes(1)
    c.stop()
  })

  it('afterDelay: clean transition before the timer fires cancels it', () => {
    const settings = makeFakeSettings({ 'files:autoSave': 'afterDelay', 'files:autoSaveDelay': 1000 })
    const file = makeFakeFile(false)
    const trigger = vi.fn()
    const c = new AutoSaveController({
      settings: settings.service,
      fileService: file.service,
      triggerSaveAll: trigger,
      getWindows: () => []
    })
    c.start()

    file.setDirty(true)
    vi.advanceTimersByTime(500)
    file.setDirty(false) // user hit Ctrl+S
    vi.advanceTimersByTime(5000)
    expect(trigger).not.toHaveBeenCalled()
    c.stop()
  })

  it('onWindowChange: blur fires save iff dirty', () => {
    const settings = makeFakeSettings({ 'files:autoSave': 'onWindowChange', 'files:autoSaveDelay': 1000 })
    const file = makeFakeFile(false)
    const trigger = vi.fn()
    const { window, asElectron } = makeFakeWindow()
    const c = new AutoSaveController({
      settings: settings.service,
      fileService: file.service,
      triggerSaveAll: trigger,
      getWindows: () => [asElectron]
    })
    c.start()

    // Blur with no dirty state — no-op.
    window.emitBlur()
    expect(trigger).not.toHaveBeenCalled()

    // Make dirty, then blur — fires.
    file.setDirty(true)
    window.emitBlur()
    expect(trigger).toHaveBeenCalledTimes(1)
    c.stop()
  })

  it('switching from afterDelay to off cancels a pending timer', () => {
    const settings = makeFakeSettings({ 'files:autoSave': 'afterDelay', 'files:autoSaveDelay': 1000 })
    const file = makeFakeFile(false)
    const trigger = vi.fn()
    const c = new AutoSaveController({
      settings: settings.service,
      fileService: file.service,
      triggerSaveAll: trigger,
      getWindows: () => []
    })
    c.start()

    file.setDirty(true)
    vi.advanceTimersByTime(500)
    settings.set('files:autoSave', 'off')
    vi.advanceTimersByTime(5000)
    expect(trigger).not.toHaveBeenCalled()
    c.stop()
  })

  it('switching from onWindowChange to off detaches the blur listener', () => {
    const settings = makeFakeSettings({ 'files:autoSave': 'onWindowChange', 'files:autoSaveDelay': 1000 })
    const file = makeFakeFile(true)
    const trigger = vi.fn()
    const { window, asElectron } = makeFakeWindow()
    const c = new AutoSaveController({
      settings: settings.service,
      fileService: file.service,
      triggerSaveAll: trigger,
      getWindows: () => [asElectron]
    })
    c.start()

    settings.set('files:autoSave', 'off')
    window.emitBlur()
    expect(trigger).not.toHaveBeenCalled()
    c.stop()
  })

  it('changing autoSaveDelay applies to the next timer cycle, not the running one', () => {
    const settings = makeFakeSettings({ 'files:autoSave': 'afterDelay', 'files:autoSaveDelay': 1000 })
    const file = makeFakeFile(false)
    const trigger = vi.fn()
    const c = new AutoSaveController({
      settings: settings.service,
      fileService: file.service,
      triggerSaveAll: trigger,
      getWindows: () => []
    })
    c.start()

    file.setDirty(true) // arms 1000ms timer
    vi.advanceTimersByTime(200)
    settings.set('files:autoSaveDelay', 5000) // does NOT extend the current timer
    vi.advanceTimersByTime(800)
    // Original 1000ms tick fires.
    expect(trigger).toHaveBeenCalledTimes(1)

    // Next dirty event uses the new 5000ms delay.
    file.setDirty(false)
    file.setDirty(true)
    vi.advanceTimersByTime(4999)
    expect(trigger).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(trigger).toHaveBeenCalledTimes(2)
    c.stop()
  })

  it('switching into afterDelay arms the timer immediately if a file is open and dirty', () => {
    // The user enables autosave while a doc is already open and has
    // unsaved edits — they expect the next save to fire after the
    // configured delay, not "after one more keystroke".
    const settings = makeFakeSettings({ 'files:autoSave': 'off', 'files:autoSaveDelay': 1000 })
    const file = makeFakeFile(true) // already dirty, file open
    const trigger = vi.fn()
    const c = new AutoSaveController({
      settings: settings.service,
      fileService: file.service,
      triggerSaveAll: trigger,
      getWindows: () => []
    })
    c.start()

    settings.set('files:autoSave', 'afterDelay')
    vi.advanceTimersByTime(999)
    expect(trigger).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(trigger).toHaveBeenCalledTimes(1)
    c.stop()
  })

  it('switching into afterDelay does not arm if no file is open', () => {
    const settings = makeFakeSettings({ 'files:autoSave': 'off', 'files:autoSaveDelay': 1000 })
    const file = makeFakeFile(true, null) // dirty registry but no file
    const trigger = vi.fn()
    const c = new AutoSaveController({
      settings: settings.service,
      fileService: file.service,
      triggerSaveAll: trigger,
      getWindows: () => []
    })
    c.start()

    settings.set('files:autoSave', 'afterDelay')
    vi.advanceTimersByTime(5000)
    expect(trigger).not.toHaveBeenCalled()
    c.stop()
  })

  it('switching into afterDelay with a clean open file does not arm', () => {
    const settings = makeFakeSettings({ 'files:autoSave': 'off', 'files:autoSaveDelay': 1000 })
    const file = makeFakeFile(false) // file open but clean
    const trigger = vi.fn()
    const c = new AutoSaveController({
      settings: settings.service,
      fileService: file.service,
      triggerSaveAll: trigger,
      getWindows: () => []
    })
    c.start()

    settings.set('files:autoSave', 'afterDelay')
    vi.advanceTimersByTime(5000)
    expect(trigger).not.toHaveBeenCalled()

    // Subsequent dirty event still works as expected.
    file.setDirty(true)
    vi.advanceTimersByTime(1000)
    expect(trigger).toHaveBeenCalledTimes(1)
    c.stop()
  })

  it('resyncs from snapshot on file path change so close+reopen+modify fires', () => {
    // Exercises the `onStateChanged` resync. Drives the flow:
    //   open → modify → save → close → reopen → modify → autosave fires.
    const settings = makeFakeSettings({ 'files:autoSave': 'afterDelay', 'files:autoSaveDelay': 1000 })
    const file = makeFakeFile(false)
    const trigger = vi.fn()
    const c = new AutoSaveController({
      settings: settings.service,
      fileService: file.service,
      triggerSaveAll: trigger,
      getWindows: () => []
    })
    c.start()

    // First round: modify → save → fires once.
    file.setDirty(true)
    vi.advanceTimersByTime(1000)
    expect(trigger).toHaveBeenCalledTimes(1)
    file.setDirty(false) // save committed

    // Close the file. State change fires with path=null; controller
    // drops any pending timer and resets cached dirty.
    file.setFilePath(null)
    file.emitStateChanged()

    // Reopen with a fresh path; state change fires with path=<new>.
    // Registry is clean on hydrate (matches restorm's real flow); no
    // autosave should fire just from opening.
    file.setFilePath('/tmp/another.restorm')
    file.emitStateChanged()
    vi.advanceTimersByTime(2000)
    expect(trigger).toHaveBeenCalledTimes(1)

    // User modifies → onDirtyChanged(true) re-arms. Without the
    // state-change resync, an upstream edge-trigger glitch could
    // leave cached dirty=true and prevent the new arm; the resync
    // pinned cached dirty=false on reopen so this arms cleanly.
    file.setDirty(true)
    vi.advanceTimersByTime(1000)
    expect(trigger).toHaveBeenCalledTimes(2)
    c.stop()
  })

  it('stop() cancels timers, detaches blur listeners, and unsubscribes', () => {
    const settings = makeFakeSettings({ 'files:autoSave': 'afterDelay', 'files:autoSaveDelay': 1000 })
    const file = makeFakeFile(false)
    const trigger = vi.fn()
    const { window, asElectron } = makeFakeWindow()
    const c = new AutoSaveController({
      settings: settings.service,
      fileService: file.service,
      triggerSaveAll: trigger,
      getWindows: () => [asElectron]
    })
    c.start()

    file.setDirty(true)
    c.stop()
    vi.advanceTimersByTime(5000)
    expect(trigger).not.toHaveBeenCalled()

    // Blur after stop is also a no-op.
    settings.set('files:autoSave', 'onWindowChange') // listener disposed; setting change no longer reaches the controller
    window.emitBlur()
    expect(trigger).not.toHaveBeenCalled()
  })

  it('afterDelay: no file open → timer fires but trigger is a no-op', () => {
    const settings = makeFakeSettings({ 'files:autoSave': 'afterDelay', 'files:autoSaveDelay': 1000 })
    const file = makeFakeFile(false, null) // no file open
    const trigger = vi.fn()
    const c = new AutoSaveController({
      settings: settings.service,
      fileService: file.service,
      triggerSaveAll: trigger,
      getWindows: () => []
    })
    c.start()

    file.setDirty(true)
    vi.advanceTimersByTime(1500)
    // Dirty without an open file should never fire — the host's
    // save-all path would have nothing to persist.
    expect(trigger).not.toHaveBeenCalled()

    // Once a file opens, the next dirty event should fire normally.
    file.setFilePath('/tmp/just-opened.restorm')
    file.setDirty(false)
    file.setDirty(true)
    vi.advanceTimersByTime(1000)
    expect(trigger).toHaveBeenCalledTimes(1)
    c.stop()
  })

  it('onWindowChange: blur with no file open does not fire', () => {
    const settings = makeFakeSettings({ 'files:autoSave': 'onWindowChange', 'files:autoSaveDelay': 1000 })
    const file = makeFakeFile(true, null) // dirty registry but no file
    const trigger = vi.fn()
    const { window, asElectron } = makeFakeWindow()
    const c = new AutoSaveController({
      settings: settings.service,
      fileService: file.service,
      triggerSaveAll: trigger,
      getWindows: () => [asElectron]
    })
    c.start()

    window.emitBlur()
    expect(trigger).not.toHaveBeenCalled()
    c.stop()
  })

  it.each<AutoSaveMode>(['off', 'afterDelay', 'onWindowChange'])(
    'tolerates an invalid stored value by falling back to off (mode = %s start state)',
    (initialMode) => {
      const settings = makeFakeSettings({ 'files:autoSave': initialMode, 'files:autoSaveDelay': 1000 })
      const file = makeFakeFile(false)
      const trigger = vi.fn()
      const c = new AutoSaveController({
        settings: settings.service,
        fileService: file.service,
        triggerSaveAll: trigger,
        getWindows: () => []
      })
      c.start()

      // A junk value coming from an outdated config or a manual edit
      // must fall back to `off` instead of throwing.
      settings.set('files:autoSave', 'wat-is-this')
      file.setDirty(true)
      vi.advanceTimersByTime(5000)
      expect(trigger).not.toHaveBeenCalled()
      c.stop()
    }
  )
})
