/**
 * A shared, non-enumerable marker the firewall stamps onto every global
 * function slot it monkey-patches (`http.request`, `globalThis.fetch`,
 * `net.Socket.prototype.connect`, …). It lets the lockdown's dev-only
 * ordering assertion tell "this slot is still our wrapper" from "a
 * later-loading dependency replaced our wrapper before we could freeze it".
 *
 * `Symbol.for` (the global registry) is deliberate: the two interceptor
 * modules — and, under a bundler that duplicates a module, two copies of
 * this file — must agree on the same symbol, or the assertion would
 * false-positive on a legitimately-patched slot.
 */
const FIREWALL_PATCH_MARKER = Symbol.for('ecui.firewall.patched')

/** Stamp `fn` as a firewall-installed wrapper. No-op on a non-function. */
export function markFirewallPatch<T>(fn: T): T {
	if (typeof fn !== 'function') return fn
	try {
		Object.defineProperty(fn, FIREWALL_PATCH_MARKER, {
			value: true,
			writable: false,
			enumerable: false,
			configurable: false
		})
	} catch {
		// A frozen function can't take the marker — harmless; the assertion
		// treats an unmarked slot as "possibly replaced", which is the safe
		// (warn-only) direction.
	}
	return fn
}

/** True when `value` carries the firewall's patch marker. */
export function isFirewallPatch(value: unknown): boolean {
	if (typeof value !== 'function' && typeof value !== 'object') return false
	if (value === null) return false
	return (value as Record<symbol, unknown>)[FIREWALL_PATCH_MARKER] === true
}
