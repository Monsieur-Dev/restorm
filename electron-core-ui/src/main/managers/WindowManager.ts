import { app } from 'electron'

/**
 * Window state interface
 */
export interface WindowState {
  width: number
  height: number
  x: number
  y: number
  fullscreen: boolean
}

/**
 * Complete window configuration interface
 */
export interface WindowConfiguration {
  name: string
  defaultWidth: number
  defaultHeight: number
  url: string | undefined
  file: string
  preloadScript?: string // Optional custom preload script path
  iconPath?: string // Optional icon path (without extension, auto-detected by platform)
  /**
   * When true the window is created hidden (`show: false`) and revealed
   * only once its renderer is ready to paint (`ready-to-show`), avoiding
   * the flash of an unstyled / half-loaded window. Used by the splash
   * handoff so the main window appears only when it's fully ready.
   */
  showWhenReady?: boolean
  /**
   * When true the window is revealed with `showInactive()` instead of
   * `show()` — it becomes visible but does NOT take OS focus, is not
   * activated, and does not switch the active virtual desktop. Use it for
   * programmatically-launched instances (e.g. automation / agent windows)
   * that must appear without stealing the user's focus. Defaults to the
   * `--inactive-window` command-line flag (see {@link isInactiveRevealRequested})
   * when left unset, so a launch can opt in via argv alone.
   */
  revealInactive?: boolean
}

/**
 * Check if DevTools should be enabled
 * In development: always enabled
 * In production: disabled by default, can be enabled with --enable-dev-tools flag
 */
export function isDevToolsEnabled(): boolean {
  return !app.isPackaged || process.argv.includes('--enable-dev-tools')
}

/**
 * Check if windows should be revealed without stealing focus.
 *
 * When the `--inactive-window` flag is present the app's windows are revealed
 * with `showInactive()` (visible but not focused/activated/raised) instead of
 * `show()`. This lets a programmatically-launched instance (an automation /
 * agent window, a background MCP dev instance, …) appear without taking the user's OS
 * focus or switching their active virtual desktop. A per-window
 * `revealInactive` configuration flag takes precedence when explicitly set.
 */
export function isInactiveRevealRequested(): boolean {
  return process.argv.includes('--inactive-window')
}

/**
 * Desktop **activation tokens** an inactive launch must drop so the OS
 * compositor does not focus the window at startup.
 *
 * On a native **Wayland** session a window cannot focus itself — focus
 * stealing is compositor-controlled and only granted when the app presents a
 * valid `xdg-activation` token. A launcher / terminal that is itself focused
 * hands that token to the child through the `XDG_ACTIVATION_TOKEN` environment
 * variable (its X11 startup-notification analogue is `DESKTOP_STARTUP_ID`), and
 * Chromium's Ozone/Wayland backend redeems it to activate the first window —
 * which is exactly why `showInactive()` is silently ignored on Wayland and the
 * window still grabs focus.
 */
export const STARTUP_ACTIVATION_ENV_VARS = ['XDG_ACTIVATION_TOKEN', 'DESKTOP_STARTUP_ID'] as const

/**
 * Remove the desktop activation tokens from an environment object (defaults to
 * the live `process.env`) so a freshly-mapped window is not activated by the
 * compositor. `delete process.env[…]` calls `unsetenv`, so the value is gone
 * from the real process environment (what the native `getenv` reads), not just
 * the JS view. Returns the keys it actually cleared (for logging / tests).
 *
 * Call this on an inactive (`--inactive-window`) launch. It is the Wayland
 * counterpart to `showInactive()`: on X11 the variables are usually unset (or
 * harmless to drop), while on Wayland dropping them is what keeps the window in
 * the background. Idempotent and safe to call when the variables are absent.
 */
export function clearStartupActivationEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const cleared: string[] = []
  // Must use `delete` (not `env[k] = undefined`, which Node stores as the
  // literal string "undefined" — a non-empty token that would still activate
  // the window). Delete each LITERAL key so the keys aren't dynamically
  // computed; `delete process.env[…]` maps to `unsetenv`, so the value is gone
  // from the real process environment the native `getenv` reads.
  if (env['XDG_ACTIVATION_TOKEN'] !== undefined) {
    delete env['XDG_ACTIVATION_TOKEN']
    cleared.push('XDG_ACTIVATION_TOKEN')
  }
  if (env['DESKTOP_STARTUP_ID'] !== undefined) {
    delete env['DESKTOP_STARTUP_ID']
    cleared.push('DESKTOP_STARTUP_ID')
  }
  return cleared
}
