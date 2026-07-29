/**
 * Main-side observation of renderer-process crashes, for EVERY window.
 *
 * The in-renderer SDK can only report a crash it survives — a JS exception, a
 * rejected promise. When the renderer PROCESS itself dies (OOM, a GPU fault, a
 * segfault in a native module) there is nothing left in that process to report
 * it, so the only witness is the main process. This is also the sole way to
 * cover the splash window: it is a `data:text/html` document with no script and
 * no preload, so there is no JS context in it to host an SDK — but its process
 * can still die, and that death is exactly the early-boot failure that leaves a
 * user staring at nothing.
 *
 * Hooked through `browser-window-created`, so every window is covered the moment
 * it exists — including windows added later, and including the splash, which is
 * created before most of the app is wired.
 */

import type { App, BrowserWindow, RenderProcessGoneDetails } from 'electron'

/** What the observer reports. Deliberately small and free of user content — a
 * process-death record carries no payload worth scrubbing, and inventing one
 * would only create a leak vector. */
export interface WindowCrashReport {
  /** `BrowserWindow.getTitle()` when readable, else `'unknown'`. Identifies the
   * SURFACE (splash vs main) without naming anything the user typed. */
  window: string
  /** Electron's reason: `crashed`, `oom`, `killed`, `launch-failed`, … */
  reason: string
  /** Platform exit code, when Electron supplied one. */
  exitCode: number | null
  /** `true` when the window died before the app finished starting — the
   * white-screen-on-launch class, and the one that can trap a user in a loop. */
  duringStartup: boolean
}

export interface WindowCrashObserverOptions {
  /** Electron's `app`, or any object with the same listener surface. */
  app: Pick<App, 'on' | 'removeListener'>
  /** Called for each renderer-process death. Wired to the gated crash reporter
   * — it must decide whether anything may actually be sent. */
  onCrash: (report: WindowCrashReport) => void
  /** True while the app is still starting up. Read at crash time, not captured,
   * so it reflects the moment of death. */
  isStartingUp: () => boolean
  log?: ((message: string, fields?: Record<string, unknown>) => void) | undefined
}

/**
 * Watch every window, current and future, for renderer-process death.
 *
 * Returns a teardown function. Safe to call once at boot — before
 * `app.whenReady()` is fine and in fact preferable, since the splash is created
 * early and an observer installed after it would miss precisely the crash it
 * most needs to see.
 */
export function observeWindowCrashes(options: WindowCrashObserverOptions): () => void {
  const handleCreated = (_event: unknown, window: BrowserWindow): void => {
    window.webContents.on('render-process-gone', (_e: unknown, details: RenderProcessGoneDetails) => {
      const report: WindowCrashReport = {
        window: safeTitle(window),
        reason: details.reason,
        exitCode: typeof details.exitCode === 'number' ? details.exitCode : null,
        duringStartup: options.isStartingUp()
      }
      options.log?.('Renderer process gone', { ...report })
      try {
        options.onCrash(report)
      } catch (error) {
        // The reporter must never be able to turn a renderer crash into a main
        // crash — that would take the whole app down over a recoverable window.
        options.log?.('Crash reporting threw while handling a renderer death', {
          error: error instanceof Error ? error.message : String(error)
        })
      }
    })
  }

  options.app.on('browser-window-created', handleCreated)
  return () => { options.app.removeListener('browser-window-created', handleCreated) }
}

/** A destroyed window throws on `getTitle()`; the crash we are reporting is
 * exactly when that is likely. */
function safeTitle(window: BrowserWindow): string {
  try {
    const title = window.getTitle()
    return title === '' ? 'unknown' : title
  } catch {
    return 'unknown'
  }
}
