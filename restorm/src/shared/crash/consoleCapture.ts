/**
 * Console-capture policy — which console levels become Sentry EVENTS rather
 * than staying breadcrumbs.
 *
 * `error` only, deliberately. A `console.error` is a failure someone chose to
 * report; capturing it as an event is what makes a survived-but-broken state
 * visible without waiting for a crash. Everything below (`warn`, `log`, …) is
 * context, not signal — it stays in the breadcrumb trail, where it already
 * travels with whatever event does get sent.
 *
 * One constant, imported by BOTH SDK inits (main and renderer), so the two
 * processes cannot drift on what "an error worth reporting" means. Shared-safe:
 * no Electron, no SDK import.
 */
export const CONSOLE_CAPTURE_LEVELS: readonly string[] = ['error']
