/**
 * ConsentFirewallExemption — keeps the firewall's system allowlist in lock-step
 * with the user's consent.
 *
 * A consent-gated destination (a crash ingest, a telemetry collector) must be
 * reachable while consent is active and INDISTINGUISHABLE FROM ANY OTHER
 * UNKNOWN HOST the moment it is revoked. Registering its host permanently and
 * "just not sending" would be a promise enforced by the sender; dropping the
 * exemption instead makes the firewall itself the enforcement point — after a
 * revocation, an SDK that keeps a queued event around and retries hits the same
 * prompt-or-block path as any third-party tracker would.
 *
 * Hosts are registered EXACT — never a wildcard. A `*.ingest.example.com` entry
 * would exempt every tenant of a shared provider, which is precisely the
 * blast-radius the firewall exists to bound.
 *
 * Sibling of `auth/avatarFirewallExemption`, same shape and same discipline:
 * electron-free, port-injected, idempotent `sync()`, and a `clear()` that
 * leaves nothing exempt behind.
 */

import type { SystemHostAllowlist } from '../auth/avatarFirewallExemption'

/** One consent-gated destination this service may exempt. */
export interface ConsentGatedEndpoint {
	/** EXACT host, or `null` when it is not configured yet — an unresolved host
	 * is never exempted. */
	host: string | null
	/** Consent gate id governing it, as understood by `canSend`. */
	consentGate: string
}

/**
 * Reconciles a set of consent-gated hosts against the live consent answers.
 * Tracks exactly the hosts it registered, so it never removes one it did not add.
 *
 * The allowlist itself is a plain set with no reference counting, so two owners
 * registering the SAME host would still clobber each other on removal. Don't do
 * that — the declared endpoints are distinct hosts by construction, and the
 * avatar exemption's host is the signed-in provider's CDN.
 */
export class ConsentFirewallExemption {
	/** Hosts this instance currently has exempted. */
	private readonly exempted = new Set<string>()

	constructor(
		private readonly allowlist: SystemHostAllowlist,
		private readonly endpoints: readonly ConsentGatedEndpoint[],
		private readonly canSend: (gate: string) => boolean
	) {}

	/**
	 * Reconcile every declared endpoint against `canSend`. Adds newly-consented
	 * hosts, drops revoked ones, and leaves everything else untouched.
	 * Idempotent — call it on every consent change and at boot. Returns the
	 * hosts exempted after the pass, sorted.
	 */
	sync(): string[] {
		const wanted = new Set<string>()
		for (const endpoint of this.endpoints) {
			if (endpoint.host === null || endpoint.host === '') continue
			if (!this.canSend(endpoint.consentGate)) continue
			wanted.add(endpoint.host.toLowerCase())
		}
		for (const host of Array.from(this.exempted)) {
			if (!wanted.has(host)) {
				this.allowlist.removeSystemAllowedHost(host)
				this.exempted.delete(host)
			}
		}
		for (const host of wanted) {
			if (!this.exempted.has(host)) {
				this.allowlist.addSystemAllowedHost(host)
				this.exempted.add(host)
			}
		}
		return Array.from(this.exempted).sort()
	}

	/** Drop every exemption this instance holds (app teardown / test reset).
	 * Idempotent. */
	clear(): void {
		for (const host of this.exempted) this.allowlist.removeSystemAllowedHost(host)
		this.exempted.clear()
	}
}
