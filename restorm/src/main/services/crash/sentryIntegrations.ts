/**
 * The SDK integrations we refuse to ship, and the filter that removes them.
 *
 * Both of these attach their payload as an ATTACHMENT rather than as event
 * fields, and `beforeSend` only ever receives the event — never the attachment
 * bytes. So neither can be scrubbed, and neither can be dropped by the gate that
 * every other payload has to pass. Our rule is that a payload which cannot be
 * proven clean is discarded; these two cannot satisfy it by construction, so the
 * only correct handling is to never produce them.
 *
 * Removing them structurally rather than leaving them switched off is the point.
 * `Screenshots` is already inert unless `attachScreenshot` is set — but "inert,
 * one option away from a catastrophic leak" is not a resting state for a surface
 * that would ship a picture of the user's URLs, tokens and request bodies. Taken
 * out of the list, no future edit can turn it back on by accident.
 *
 * Kept free of Electron and of the SDK itself so the guarantee is unit-testable:
 * the composition root passes the SDK's resolved defaults through this, and the
 * test asserts the names are gone.
 */

/** Integration names removed from the SDK's defaults, with why. */
export const UNSCRUBBABLE_INTEGRATIONS = [
  /**
   * Native crash capture. Starts Crashpad writing minidumps to disk, and on the
   * next arm uploads dumps left over from previous runs — including ones from
   * before the SDK was ever armed. A minidump is raw process memory, which for
   * this app means bearer tokens, request and response bodies, decrypted
   * credentials and environment variables, in an opaque blob nothing can redact.
   */
  'SentryMinidump',
  /**
   * Attaches a PNG of every visible window to the event. For an API client that
   * is a picture of exactly the data the scrubber exists to remove.
   */
  'Screenshots'
] as const

/**
 * Drop the integrations above from a list of SDK defaults.
 *
 * Matches on the integration's own `name`, which is the only stable handle the
 * SDK exposes. A rename on their side would therefore silently stop matching —
 * which is why the accompanying test pins the exact names rather than deriving
 * them, so an upgrade that renames one fails a test instead of quietly
 * re-enabling a leak.
 */
export function withoutUnscrubbableIntegrations<T extends { name: string }>(
  defaults: readonly T[]
): T[] {
  const banned: readonly string[] = UNSCRUBBABLE_INTEGRATIONS
  return defaults.filter((integration) => !banned.includes(integration.name))
}
