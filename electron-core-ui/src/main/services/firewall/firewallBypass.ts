/**
 * Cooperative firewall bypass for user-initiated outbound traffic the
 * project knows is intentional — the Send-button request runner, the
 * import flow (URL paste / drag-and-drop on the Import modal), the
 * mini-browser, and any future always-allowed path.
 *
 * Rationale: the firewall exists to gate background traffic the user
 * didn't explicitly ask for. When the user clicks Send, or types / drops
 * a URL into the Import dialog, they have already authorised that one
 * fetch — the firewall popping a second prompt is friction, and on a
 * brand-new project with empty `projectOrigins` it auto-denies (no UI to
 * answer the prompt yet, or no `projectOrigins` entry to short-circuit to
 * `allow`), turning the chicken-and-egg "I have to whitelist the very
 * thing I'm about to import" dance into a hard block.
 *
 * Why `AsyncLocalStorage` and not a module-global counter: the bypass
 * must apply ONLY to the async call-chain that opened it, never to
 * unrelated traffic that happens to overlap it on the event loop. A
 * global counter leaks — e.g. an httpRequest node holds its bypass open
 * across the whole in-flight request, and the scheduler runs nodes
 * concurrently, so a `code` node's sandbox `fetch` whose socket connects
 * during that window would read `bypassed = true` and skip the firewall.
 * That defeats the sandbox's headline guarantee (every sandbox network
 * call is firewall-governed). `AsyncLocalStorage` scopes the bypass to
 * the continuation of `fn`: the request runner's own socket connect (made
 * synchronously inside `run`) inherits it, while a concurrent sandbox
 * fetch — a separate async context — does not, so the firewall gates it.
 *
 * Nesting (an importer recursively kicking off `$ref` fetches inside an
 * outer bypass) is handled for free: an inner `run` inherits the outer
 * store and the scope unwinds when each `fn` settles, even on throw.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

const bypassStorage = new AsyncLocalStorage<true>()

export function isFirewallBypassed(): boolean {
  return bypassStorage.getStore() === true
}

export function withFirewallBypass<T>(fn: () => Promise<T>): Promise<T> {
  return bypassStorage.run(true, fn)
}

/**
 * Synchronous counterpart of {@link withFirewallBypass}. Use it to wrap a
 * synchronous outbound-connect expression whose socket is opened during the
 * call itself — e.g. a protocol client's constructor (`new WebSocket(url)`,
 * `io(url)`, `mqtt.connect(url)`) that synchronously starts the handshake /
 * raw-socket connect. The bypass is in scope only for the synchronous body,
 * which is exactly when the connect fires, so the interceptor short-circuits
 * to `allow`. (The async {@link withFirewallBypass} is for request runners
 * whose whole in-flight chain must inherit the bypass; a connect made after
 * an `await` would have already left that scope, so wrap the connect call
 * directly with this instead.)
 */
export function withFirewallBypassSync<T>(fn: () => T): T {
  return bypassStorage.run(true, fn)
}
