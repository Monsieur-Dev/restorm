/**
 * Shared cookie types + IPC channel names for the Cookie Manager
 * (`window.api.cookies.*`). The jar lives in the main process
 * (`CookieJarService`); the renderer sends an environment key and gets
 * back the flattened cookie rows.
 */

/** IPC channels exposing the per-environment cookie jar to the renderer. */
export const COOKIE_IPC = {
  LIST: 'cookie:list',
  ADD: 'cookie:add',
  REMOVE: 'cookie:remove',
  CLEAR_DOMAIN: 'cookie:clear-domain',
  CLEAR: 'cookie:clear',
  /** main → renderer push: a jar mutated (Set-Cookie captured, add/remove/clear). */
  CHANGED: 'cookie:changed'
} as const

/** A plain name→value cookie pair, for the per-request response Cookies tab
 * (cookies sent with the request / received in the response). */
export interface CookiePair {
  name: string
  value: string
}

/** A cookie flattened for the Cookie Manager. */
export interface CookieRow {
  key: string
  value: string
  domain: string
  path: string
  /** ISO string, or null for a session cookie (no expiry). */
  expires: string | null
  secure: boolean
  httpOnly: boolean
  sameSite: string | null
  /** true = host-only (no Domain attribute); false = domain cookie. */
  hostOnly: boolean
}

/** A user-authored cookie to inject (Cookie Manager "add"). The value may
 * embed `{{var}}`, resolved against the active environment at send time. */
export interface CookieInput {
  key: string
  value: string
  domain: string
  path?: string
  /** ISO string; omitted/empty = session cookie. */
  expires?: string
  secure?: boolean
  httpOnly?: boolean
  sameSite?: string
}
