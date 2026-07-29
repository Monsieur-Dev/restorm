import { describe, it, expect, vi } from 'vitest'
import { observeWindowCrashes, type WindowCrashReport } from './windowCrashObserver'
import type { App, BrowserWindow, RenderProcessGoneDetails } from 'electron'

/** Minimal stand-ins for Electron's event emitters — enough to drive the
 * observer without booting Electron. */
function makeApp(): Pick<App, 'on' | 'removeListener'> & {
  emitWindowCreated: (window: BrowserWindow) => void
  listenerCount: () => number
} {
  const handlers: ((event: unknown, window: BrowserWindow) => void)[] = []
  return {
    on(event: string, handler: (...args: never[]) => void) {
      if (event === 'browser-window-created') handlers.push(handler as never)
      return this
    },
    removeListener(_event: string, handler: (...args: never[]) => void) {
      const i = handlers.indexOf(handler as never)
      if (i >= 0) handlers.splice(i, 1)
      return this
    },
    emitWindowCreated(window: BrowserWindow): void {
      for (const h of [...handlers]) h(null, window)
    },
    listenerCount: (): number => handlers.length
  } as never
}

function makeWindow(title: string | (() => never) = 'Restorm'): BrowserWindow & {
  emitGone: (details: RenderProcessGoneDetails) => void
} {
  const handlers: ((event: unknown, details: RenderProcessGoneDetails) => void)[] = []
  return {
    getTitle: typeof title === 'function' ? title : (): string => title,
    webContents: {
      on(event: string, handler: (...args: never[]) => void) {
        if (event === 'render-process-gone') handlers.push(handler as never)
      }
    },
    emitGone(details: RenderProcessGoneDetails): void {
      for (const h of [...handlers]) h(null, details)
    }
  } as never
}

const gone = (overrides: Partial<RenderProcessGoneDetails> = {}): RenderProcessGoneDetails =>
  ({ reason: 'crashed', exitCode: 133, ...overrides }) as RenderProcessGoneDetails

describe('observeWindowCrashes', () => {
  it('reports a renderer-process death with its surface and reason', () => {
    const app = makeApp()
    const onCrash = vi.fn<(r: WindowCrashReport) => void>()
    observeWindowCrashes({ app, onCrash, isStartingUp: () => false })

    const window = makeWindow('Restorm')
    app.emitWindowCreated(window)
    window.emitGone(gone({ reason: 'oom', exitCode: 9 }))

    expect(onCrash).toHaveBeenCalledWith({
      window: 'Restorm',
      reason: 'oom',
      exitCode: 9,
      duringStartup: false
    })
  })

  it('covers the splash — the one window that cannot host an in-renderer SDK', () => {
    // The splash is a `data:text/html` document with no script and no preload,
    // so nothing inside it could ever report its own death. Main-side
    // observation is the only witness, and an early-boot splash death is the
    // white-screen-on-launch case.
    const app = makeApp()
    const onCrash = vi.fn<(r: WindowCrashReport) => void>()
    observeWindowCrashes({ app, onCrash, isStartingUp: () => true })

    const splash = makeWindow('')
    app.emitWindowCreated(splash)
    splash.emitGone(gone({ reason: 'crashed' }))

    expect(onCrash).toHaveBeenCalledWith(
      expect.objectContaining({ window: 'unknown', duringStartup: true })
    )
  })

  it('reads the startup flag at crash time, not at install time', () => {
    let starting = true
    const app = makeApp()
    const onCrash = vi.fn<(r: WindowCrashReport) => void>()
    observeWindowCrashes({ app, onCrash, isStartingUp: () => starting })

    const window = makeWindow()
    app.emitWindowCreated(window)
    starting = false
    window.emitGone(gone())

    expect(onCrash.mock.calls[0]?.[0].duringStartup).toBe(false)
  })

  it('covers windows created AFTER the observer was installed', () => {
    const app = makeApp()
    const onCrash = vi.fn<(r: WindowCrashReport) => void>()
    observeWindowCrashes({ app, onCrash, isStartingUp: () => false })

    const first = makeWindow('one')
    const second = makeWindow('two')
    app.emitWindowCreated(first)
    app.emitWindowCreated(second)
    second.emitGone(gone())

    expect(onCrash).toHaveBeenCalledTimes(1)
    expect(onCrash.mock.calls[0]?.[0].window).toBe('two')
  })

  it('normalises a missing exit code rather than emitting undefined', () => {
    const app = makeApp()
    const onCrash = vi.fn<(r: WindowCrashReport) => void>()
    observeWindowCrashes({ app, onCrash, isStartingUp: () => false })
    const window = makeWindow()
    app.emitWindowCreated(window)
    window.emitGone({ reason: 'killed' } as RenderProcessGoneDetails)
    expect(onCrash.mock.calls[0]?.[0].exitCode).toBeNull()
  })

  it('survives a window whose title throws — likely precisely when it crashed', () => {
    const app = makeApp()
    const onCrash = vi.fn<(r: WindowCrashReport) => void>()
    observeWindowCrashes({ app, onCrash, isStartingUp: () => false })
    const window = makeWindow((): never => { throw new Error('destroyed') })
    app.emitWindowCreated(window)
    window.emitGone(gone())
    expect(onCrash.mock.calls[0]?.[0].window).toBe('unknown')
  })

  it('never lets the reporter turn a renderer crash into a main-process crash', () => {
    const log = vi.fn()
    const app = makeApp()
    observeWindowCrashes({
      app,
      onCrash: () => { throw new Error('reporter exploded') },
      isStartingUp: () => false,
      log
    })
    const window = makeWindow()
    app.emitWindowCreated(window)
    expect(() => { window.emitGone(gone()) }).not.toThrow()
    expect(log.mock.calls.some(([m]) => String(m).includes('threw'))).toBe(true)
  })

  it('detaches on teardown', () => {
    const app = makeApp()
    const stop = observeWindowCrashes({ app, onCrash: vi.fn(), isStartingUp: () => false })
    expect(app.listenerCount()).toBe(1)
    stop()
    expect(app.listenerCount()).toBe(0)
  })
})
