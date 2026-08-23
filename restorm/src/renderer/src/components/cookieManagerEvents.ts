/**
 * Local event that asks the (titlebar-mounted) Cookie Manager to open,
 * optionally pre-filtered on one origin. Emitted by the response panel's
 * "cookies" chip when a response carried Set-Cookie, so a click deep-links
 * straight to the cookies that response stored.
 */
export const COOKIE_MANAGER_OPEN = 'cookies:manager:open'

export interface CookieManagerOpenPayload {
  /** Origin/host to surface first in the manager (from the response URL). */
  focusDomain?: string
}
