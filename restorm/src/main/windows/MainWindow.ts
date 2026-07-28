import { join } from 'path'
import type { BrowserWindowConstructorOptions } from 'electron'
import { RestormWindow } from './RestormWindow'

/**
 * True under the Playwright e2e harness — it sets `RESTORM_USER_DATA_OVERRIDE`
 * per launch (the same signal the splash suppression + firewall bypass read).
 * Used to skip the splash min-display delay so tests aren't slowed on every
 * window reveal.
 */
function isE2EHarness(): boolean {
  const v = process.env['RESTORM_USER_DATA_OVERRIDE']
  return typeof v === 'string' && v.length > 0
}

/** Options for the main application window. */
export interface MainWindowOptions {
  /**
   * Reveal the window without taking OS focus (showInactive) instead of the
   * focusing show(). Set for programmatic launches (the dev:restorm:mcp
   * launcher, e2e/agent windows) so they appear without stealing the user's
   * focus or switching their active virtual desktop. Defaults to false (normal
   * focusing launch).
   */
  revealInactive?: boolean
}

/**
 * MainWindow - Main application window
 */
export class MainWindow extends RestormWindow {
  constructor(options: MainWindowOptions = {}) {
    // Create configuration object using restormWindow static helper
    const configuration = RestormWindow.createConfiguration({
      name: 'main',
      defaultWidth: 1200,
      defaultHeight: 800,
      url: process.env['ELECTRON_RENDERER_URL'],
      file: join(__dirname, '../renderer/index.html'),
      iconPath: join(__dirname, '../../assets/icons/icon'),
      // Stay hidden until the renderer is ready to paint so the splash can
      // hand off to a fully-ready window with no flash of an unstyled view.
      showWhenReady: true,
      // Keep the splash on screen long enough to read the logo on a fast boot
      // instead of flashing a coloured square (the splash closes as part of this
      // window's ready-to-show handoff, so delaying the handoff holds the splash).
      // Skipped under the e2e harness (splash suppressed there) so tests aren't
      // delayed on every window reveal.
      ...(isE2EHarness() ? {} : { minReadyDelayMs: 3000 }),
      // Reveal without focus when launched for automation/agents (--inactive-window).
      revealInactive: options.revealInactive
    })
    super(configuration)
  }

  /**
   * Enable the `<webview>` tag for the Mini browser. The Mini browser
   * needs to embed arbitrary third-party origins (e.g. play.artifactsmmo.com)
   * and let those pages use their own localStorage / IndexedDB / cookies.
   * A plain `<iframe>` in restorm's renderer is a *cross-site* third-party
   * context for those origins, and Chrome 137+'s storage partitioning
   * silently blocks their `localStorage` access — login forms that store
   * JWTs in localStorage just stop working with no visible error.
   *
   * Electron `<webview>` is process-isolated with its own top-level
   * browsing context, so the embedded page behaves like a real browser
   * tab and storage works normally. The flag is off by default in
   * Electron for safety, so we opt in here.
   */
  protected override createWindow(options: Partial<BrowserWindowConstructorOptions> = {}): void {
    super.createWindow({
      ...options,
      webPreferences: {
        ...(options.webPreferences ?? {}),
        webviewTag: true
      }
    })
  }
}
