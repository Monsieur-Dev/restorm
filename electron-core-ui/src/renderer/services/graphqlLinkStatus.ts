/**
 * Link status for the renderer's GraphQL subscriptions channel.
 *
 * - `ok`          — at least one connection reached the server recently.
 * - `reconnecting`— the underlying SSE layer is retrying. UI should nudge
 *                   the user: incoming subscription events may be stale.
 * - `failed`      — the transient-error budget has been exceeded and the
 *                   link hasn't come back yet. graphql-sse keeps trying
 *                   under the hood (we configure `retryAttempts: Infinity`),
 *                   but we surface the distinction so the UI can escalate
 *                   (different icon / tooltip).
 */
export type GraphQLLinkStatus = 'ok' | 'reconnecting' | 'failed'

/**
 * Initial backoff delay between reconnect attempts.
 * Intentionally short so transient hiccups (main-process auto-restart in
 * dev, kernel wake from sleep, brief Wi-Fi flap) recover in <1 s.
 */
export const INITIAL_RETRY_DELAY_MS = 500

/**
 * Cap on the reconnect delay. Long enough to stop hammering a dead server,
 * short enough that a real recovery lands within seconds of the server
 * coming back.
 */
export const MAX_RETRY_DELAY_MS = 15_000

/**
 * Symmetric jitter applied to the computed delay, expressed as a fraction
 * of the delay itself. 0.3 = ±30 %. Prevents the 6 concurrent subscriptions
 * the host opens from all hitting the server in the same tick after an
 * outage (thundering herd). Tuned on the higher side because the first
 * retry is only 500 ms and we need enough spread to meaningfully de-sync
 * the streams — AWS-style "full jitter" would also work but empirically
 * adds too much worst-case latency on recoveries.
 */
export const JITTER_FACTOR = 0.3

/**
 * Duration of continuous "reconnecting" state before the UI escalates
 * from `reconnecting` to `failed`. Time-based (not per-attempt) so that
 * the threshold doesn't depend on how many subscriptions the host app
 * opened — graphql-sse emits `connecting(reconnecting=true)` once per
 * subscription in distinct-connections mode, so an attempt counter
 * would amplify linearly with subscription count. A real outage lasting
 * more than this wall-clock window escalates regardless of retry
 * cadence; a flap that recovers inside the window stays as
 * `reconnecting`. The underlying retry never stops — the state change
 * is purely UI.
 */
export const FAILED_AFTER_RECONNECTING_MS = 60_000

/**
 * Compute the backoff delay (in ms) for a given attempt index.
 * Exponential (500ms → 1s → 2s → 4s → 8s → 15s → 15s → …), clamped to
 * {@link MAX_RETRY_DELAY_MS}, with ±{@link JITTER_FACTOR} jitter applied.
 *
 * @param attempts Zero-based attempt index — 0 for the first retry after
 *                 the first disconnect.
 * @param random   Injectable RNG for deterministic tests. Defaults to
 *                 `Math.random`.
 */
export function computeBackoffDelay(attempts: number, random: () => number = Math.random): number {
  const baseDelay = Math.min(INITIAL_RETRY_DELAY_MS * 2 ** attempts, MAX_RETRY_DELAY_MS)
  const jitter = baseDelay * JITTER_FACTOR * (random() * 2 - 1)
  return Math.max(0, Math.round(baseDelay + jitter))
}
