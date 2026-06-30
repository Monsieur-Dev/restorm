/**
 * Entitlement auto-refresh driver — turns two ambient signals into re-fetch
 * triggers so a subscription change (notably a self-upgrade via « S'abonner »)
 * reflects in a running app WITHOUT a sign-out/in:
 *
 *   - **window focus** — fires when the user returns to the app, e.g. straight
 *     after completing the Paddle checkout in the SYSTEM browser. This is the
 *     honest "checkout returned" signal: the checkout opens in an external
 *     browser, so the only moment the app learns the user is back is on focus.
 *   - **a periodic poll** while the app stays open, so a change made elsewhere
 *     (another device, the dashboard, an admin grant) still lands in ≲ a poll.
 *
 * The actual re-fetch / verify / cache / broadcast (and the signed-out no-op,
 * the offline fail-soft, the firewall-bypassed fetch) all live in
 * `EntitlementService.refresh()`; this module only decides WHEN to call it. It is
 * electron-free (the focus subscription + timer are injected) so it is fully
 * unit-testable, mirroring the rest of the auth stack.
 */

/** Default poll interval (ms) while signed in + online: ~2.5 min, so any backend
 * subscription change reflects in well under a minute on top of the focus path. */
export const DEFAULT_AUTO_REFRESH_INTERVAL_MS = 150_000

/** Minimum gap (ms) between two triggered refreshes. Coalesces a focus storm
 * (rapid alt-tabbing back and forth) into at most one backend round-trip per
 * window, so the ambient triggers never hammer the entitlement endpoint. */
export const DEFAULT_AUTO_REFRESH_MIN_GAP_MS = 30_000

export interface AutoRefreshOptions {
  /** Re-fetch the entitlement (typically `() => void service.refresh()`). */
  refresh: () => void
  /** Subscribe to window-focus; returns an unsubscribe fn. */
  onFocus: (handler: () => void) => () => void
  /** Poll interval; defaults to {@link DEFAULT_AUTO_REFRESH_INTERVAL_MS}. */
  intervalMs?: number
  /** Throttle window; defaults to {@link DEFAULT_AUTO_REFRESH_MIN_GAP_MS}. */
  minGapMs?: number
  /** Injectable clock (epoch ms); defaults to `Date.now`. */
  now?: () => number
  /** Injectable timer (defaults to the global) — overridden in tests. */
  setIntervalImpl?: (handler: () => void, ms: number) => ReturnType<typeof setInterval>
  clearIntervalImpl?: (handle: ReturnType<typeof setInterval>) => void
}

/**
 * Start the focus + interval refresh triggers. Returns a `dispose()` that stops
 * the timer and detaches the focus listener — call it on app quit so neither a
 * dangling timer nor a stale listener outlives the service.
 */
export function startEntitlementAutoRefresh(options: AutoRefreshOptions): () => void {
  const {
    refresh,
    onFocus,
    intervalMs = DEFAULT_AUTO_REFRESH_INTERVAL_MS,
    minGapMs = DEFAULT_AUTO_REFRESH_MIN_GAP_MS,
    now = Date.now,
    setIntervalImpl = setInterval,
    clearIntervalImpl = clearInterval
  } = options

  let lastRefreshAt = Number.NEGATIVE_INFINITY

  // Both triggers funnel through here so the throttle applies uniformly.
  const maybeRefresh = (): void => {
    const ts = now()
    if (ts - lastRefreshAt < minGapMs) return
    lastRefreshAt = ts
    refresh()
  }

  const timer = setIntervalImpl(maybeRefresh, intervalMs)
  const unsubscribeFocus = onFocus(maybeRefresh)

  return (): void => {
    clearIntervalImpl(timer)
    unsubscribeFocus()
  }
}
