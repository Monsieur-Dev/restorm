import { BrowserWindow, nativeImage } from 'electron'
import { logger } from '../services'
import { isInactiveRevealRequested } from './WindowManager'

/**
 * Options describing the splash screen an application wants to show while it
 * boots. Everything is generic — the consuming app supplies only its own
 * logo (and optionally tweaks the size / background). No app-specific content
 * is baked into the library.
 */
export interface SplashWindowOptions {
  /**
   * Absolute path to the logo image file (png / jpg / svg / …). It is read
   * and inlined as a data URL, so the splash HTML needs no asset server and
   * works identically in dev and packaged builds. Prefer this over
   * `logoDataUrl` when you just have a file on disk.
   */
  logoPath?: string
  /**
   * The logo as a ready-made data URL (`data:image/png;base64,…`). Use this
   * when the image is already in memory; takes precedence over `logoPath`.
   */
  logoDataUrl?: string
  /** Splash width in pixels. Defaults to 800. */
  width?: number
  /** Splash height in pixels. Defaults to 350. */
  height?: number
  /**
   * CSS background of the splash surface. Defaults to `transparent` so the
   * window blends with the desktop; pass a solid colour (e.g. `#1a1a2e`) for
   * an opaque card.
   */
  background?: string
  /**
   * Max width of the logo inside the splash, in pixels. Defaults to 240.
   * The logo keeps its aspect ratio (`height: auto`).
   */
  logoMaxWidth?: number
  /**
   * When true the splash is revealed with `showInactive()` — visible but NOT
   * focused/activated/raised, and the active virtual desktop does not change.
   * Use it for programmatically-launched instances (automation / agent
   * windows) so the splash, which appears before the main window, does not
   * steal the user's focus on startup. When left unset it defaults to the
   * `--inactive-window` command-line flag (see {@link isInactiveRevealRequested}),
   * so a launch can opt in via argv alone — keeping the splash and the main
   * window's reveal behaviour in sync. Absent / false → focusing `show()` as
   * before.
   */
  revealInactive?: boolean
}

/**
 * A live splash window. The boot lifecycle closes it (via {@link close}) right
 * before the main window is shown.
 */
export interface SplashWindowHandle {
  /** The underlying BrowserWindow, or null once closed. */
  getWindow(): BrowserWindow | null
  /** Close + destroy the splash. Idempotent. */
  close(): void
}

const DEFAULT_WIDTH = 800
const DEFAULT_HEIGHT = 350
const DEFAULT_LOGO_MAX_WIDTH = 240

/**
 * Resolve the logo to a data URL. A caller-provided data URL wins; otherwise
 * the file at `logoPath` is read and inlined. Returns an empty string when
 * neither is usable (the splash still renders, just without a logo).
 */
function resolveLogoDataUrl(options: SplashWindowOptions): string {
  if (options.logoDataUrl) {
    return options.logoDataUrl
  }
  if (options.logoPath) {
    try {
      const image = nativeImage.createFromPath(options.logoPath)
      if (!image.isEmpty()) {
        return image.toDataURL()
      }
      logger.warn('Splash logo image is empty', { path: options.logoPath })
    } catch (error) {
      logger.error('Failed to read splash logo', { path: options.logoPath, error: String(error) })
    }
  }
  return ''
}

/**
 * Build the splash HTML. The whole surface is draggable
 * (`-webkit-app-region: drag`) so the user can grab the splash anywhere.
 */
function buildSplashHtml(logoDataUrl: string, background: string, logoMaxWidth: number): string {
  const logoImg = logoDataUrl
    ? `<img src="${logoDataUrl}" alt="" draggable="false" style="max-width:${logoMaxWidth}px;width:100%;height:auto;-webkit-user-select:none;user-select:none;" />`
    : ''
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: ${background};
        /* The entire window surface is a drag handle. */
        -webkit-app-region: drag;
        -webkit-user-select: none;
        user-select: none;
      }
      .splash-root {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
      }
    </style>
  </head>
  <body>
    <div class="splash-root">${logoImg}</div>
  </body>
</html>`
}

/**
 * Create and show a centered, frameless, always-on-top splash window with the
 * given logo. The window is shown immediately so it appears before the main
 * window exists. Call {@link SplashWindowHandle.close} to dismiss it.
 *
 * Generic by design: the library owns the WINDOW + the MECHANICS (size,
 * centering, frameless, transparency, whole-surface drag, always-on-top);
 * the application owns only the CONTENT (its logo).
 */
export function createSplashWindow(options: SplashWindowOptions): SplashWindowHandle {
  const width = options.width ?? DEFAULT_WIDTH
  const height = options.height ?? DEFAULT_HEIGHT
  const background = options.background ?? 'transparent'
  const logoMaxWidth = options.logoMaxWidth ?? DEFAULT_LOGO_MAX_WIDTH
  const transparent = background === 'transparent'
  // Reveal without focus when the splash was launched for an automation /
  // agent instance. A per-splash `revealInactive` wins when explicitly set;
  // otherwise the global `--inactive-window` flag decides — mirroring the main
  // window's reveal so the splash, shown first in the boot sequence, never
  // steals the user's focus on a programmatic launch.
  const inactive = options.revealInactive ?? isInactiveRevealRequested()

  const splash = new BrowserWindow({
    width,
    height,
    frame: false,
    transparent,
    // A transparent window must not paint its own background colour.
    ...(transparent ? {} : { backgroundColor: background }),
    center: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // When revealing inactively, stay hidden at construction and reveal via
    // `showInactive()` below so the splash never grabs focus. Otherwise show
    // immediately (focus + raise) as before.
    show: !inactive,
    webPreferences: {
      // Static HTML only — no preload, no node integration needed.
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  // Belt-and-suspenders: `center: true` already centers on the primary
  // display, but call it explicitly so the splash is centered even if the
  // platform ignored the constructor hint.
  splash.center()

  if (inactive) {
    logger.info('Splash window revealed without focus (showInactive)')
    splash.showInactive()
  }

  const logoDataUrl = resolveLogoDataUrl(options)
  const html = buildSplashHtml(logoDataUrl, background, logoMaxWidth)
  splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch((error: unknown) => {
    logger.error('Failed to load splash content', { error: String(error) })
  })

  logger.info('Splash window created', { width, height })

  let closed = false
  return {
    getWindow: () => (splash.isDestroyed() ? null : splash),
    close: () => {
      if (closed) {
        return
      }
      closed = true
      if (!splash.isDestroyed()) {
        splash.close()
      }
    }
  }
}
