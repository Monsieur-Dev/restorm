/**
 * Pure decision helpers for WHETHER the embedded MCP server should run, and
 * whether a programmatically-created instance should launch inactive.
 *
 * MCP-on is governed by exactly two inputs — the user-facing `mcp:enabled`
 * setting (default ON) and a headless rule — with no CLI flag or env toggle
 * anymore. Keeping the logic here (Electron-free) makes it unit-testable; the
 * Electron entrypoint reads the setting + the live env and delegates.
 */

/**
 * True on a true headless host: no usable display, so no human is watching and
 * no AI agent is driving the UI. MCP must NEVER start there, regardless of the
 * setting.
 *
 * Detection is the ABSENCE of a usable display. On Linux that means neither
 * `DISPLAY` (X11) nor `WAYLAND_DISPLAY` is set to a non-empty value. CRITICAL:
 * a virtual display (xvfb — what the e2e harness runs under) DOES set `DISPLAY`,
 * so an xvfb run is NOT headless and keeps MCP on; only a bare host with no
 * display at all counts. On macOS / Windows there is always a display, so this
 * is always false there.
 */
export function isHeadlessHost(params: {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
}): boolean {
  const { platform, env } = params
  if (platform !== 'linux') return false
  const x11 = env['DISPLAY']?.trim()
  const wayland = env['WAYLAND_DISPLAY']?.trim()
  return (x11 === undefined || x11 === '') && (wayland === undefined || wayland === '')
}

/**
 * Effective MCP-on decision for a launch: the user setting (default ON, only an
 * EXPLICIT `false` disables it) AND a usable display (never on a headless host).
 *
 * `settingValue` is the raw stored value of `mcp:enabled` (a real boolean once
 * the user has touched the toggle; `undefined` or the settings store's
 * empty-string default when never set / cleared). Anything that is not a hard
 * `false` counts as ON, since MCP is on by default.
 */
export function isMcpEnabledForLaunch(params: {
  settingValue: unknown
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
}): boolean {
  const { settingValue, platform, env } = params
  const settingEnabled = settingValue !== false
  return settingEnabled && !isHeadlessHost({ platform, env })
}

/**
 * Whether a programmatically-created instance (the `create_instance` route's
 * spawn) should launch WITHOUT taking OS focus. A create-instance is a USER
 * action — the user must SEE what the AI opened — so it launches ACTIVE by
 * default. The focus-suppression flag is applied ONLY under the e2e/test
 * marker (`RESTORM_USER_DATA_OVERRIDE`, set by the Playwright fixture) so
 * automated launches don't steal the harness's focus.
 */
export function shouldLaunchInactive(env: NodeJS.ProcessEnv): boolean {
  return (env['RESTORM_USER_DATA_OVERRIDE'] ?? '').length > 0
}
