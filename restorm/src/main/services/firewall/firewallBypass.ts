/**
 * Cooperative firewall bypass for user-initiated outbound traffic the
 * project knows is intentional — currently the import flow (URL
 * paste / drag-and-drop on the Import modal) and any future
 * always-allowed path.
 *
 * Rationale (same as the request-runner and mini-browser bypasses):
 * the firewall exists to gate background traffic the user didn't
 * explicitly ask for. When the user types or drops a URL into the
 * Import dialog, they have already authorised that one fetch — the
 * firewall popping a second prompt is friction, and on a brand-new
 * project with empty `projectOrigins` it auto-denies (no UI to
 * answer the prompt yet, or no projectOrigins entry to short-circuit
 * to `allow`), turning the chicken-and-egg "I have to whitelist the
 * very thing I'm about to import" dance into a hard block.
 *
 * Why a counter and not a boolean: importers can recursively kick
 * off follow-up fetches (e.g. resolving `$ref`s). The
 * decrement-in-finally guarantees the bypass scope unwinds correctly
 * even when an inner fetch throws.
 *
 * The bypass is intentionally NOT an `AsyncLocalStorage`: the
 * importers run on the main thread and don't interleave with other
 * traffic that should see the firewall — keeping it module-scoped
 * makes the call-site contract obvious (`withFirewallBypass(fn)`)
 * without an extra dependency on Node's async-context machinery.
 */

let bypassDepth = 0

export function isFirewallBypassed(): boolean {
  return bypassDepth > 0
}

export async function withFirewallBypass<T>(fn: () => Promise<T>): Promise<T> {
  bypassDepth++
  try {
    return await fn()
  } finally {
    bypassDepth--
  }
}
