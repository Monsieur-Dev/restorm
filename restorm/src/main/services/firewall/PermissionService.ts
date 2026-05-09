import { logger } from 'electron-core-ui'

/**
 * Firewall mode — drives `PermissionService.check`'s default
 * behaviour for unknown destinations.
 *
 * - `strict`: unknown destination → emit a `pending` verdict +
 *   broadcast a toast-prompt IPC; resolve to `allow` / `deny`
 *   when the user picks. Default first-run experience after
 *   Phase 4C ships the toast UI.
 * - `log-only`: unknown destination → resolve immediately to
 *   `allow`, but the audit log keeps the entry so the user can
 *   review what tried to call out. Default first-run while the
 *   toast UI is still in flight (Phase 4A → 4B → 4C).
 * - `lockdown`: unknown destination → resolve immediately to
 *   `deny`, no prompt. The "I'm running an untrusted plugin and
 *   nothing else should be able to phone home" mode.
 */
export type FirewallMode = 'strict' | 'log-only' | 'lockdown'

/**
 * Verdict the `PermissionService` returns to the calling
 * interception layer. `pending` is the only async case — it
 * means the toast prompt is in flight and the caller should
 * buffer its writes until a follow-up `allow` / `deny` lands.
 * Phase 4A: `pending` never returned (everything resolves to
 * `allow` synchronously); the wiring is in place for 4C when
 * the toast lands.
 */
export type Verdict = 'allow' | 'deny'

/**
 * Subset of `RequestRecord` the service needs for its decision —
 * keeps the interface small and decoupled from the full record
 * shape so we don't have to thread the `id` / `timestamp` /
 * etc. through every code path that just wants "may I talk to
 * this host:port?".
 */
export interface CheckInput {
	host: string
	port: number
	source: string
}

/**
 * Localhost aliases that bypass the allowlist + prompt — the
 * Restorm app talks to its own GraphQL bridge via localhost,
 * and the user's mocking tools (msw, json-server, …) usually
 * also bind to localhost. Blocking these would brick the app.
 */
const LOCALHOST_HOSTS = new Set<string>(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'])

/**
 * `PermissionService` — single source of truth for outbound-call
 * verdicts. Phase 4A is the **skeleton**: in-memory mode +
 * allowlist, localhost short-circuit, wildcard-glob matcher.
 * Phases 4B-4C will add per-project persistence + toast prompt.
 *
 * Stays in the main process (it owns the allowlist file + the
 * BufferingClientRequest contract). The renderer interacts via
 * an IPC bridge added in Phase 4B.
 */
class PermissionService {
	private mode: FirewallMode = 'log-only'

	/**
	 * In-memory allowlist of host patterns. Each entry is either
	 * a literal hostname (`api.example.com`) or a single-level
	 * wildcard (`*.example.com`, matches one DNS label). Phase
	 * 4B will persist this to the .restorm file.
	 */
	private readonly allowlist = new Set<string>()

	getMode(): FirewallMode {
		return this.mode
	}

	setMode(mode: FirewallMode): void {
		if (this.mode === mode) return
		this.mode = mode
		logger.info('PermissionService: mode changed', { mode })
	}

	/**
	 * Add a host pattern to the allowlist. Pattern is the literal
	 * hostname or a single-level wildcard (`*.example.com`). The
	 * lookup is case-insensitive — entries are lower-cased on
	 * insert.
	 */
	addToAllowlist(pattern: string): void {
		this.allowlist.add(pattern.toLowerCase())
	}

	removeFromAllowlist(pattern: string): void {
		this.allowlist.delete(pattern.toLowerCase())
	}

	listAllowlist(): string[] {
		return Array.from(this.allowlist).sort()
	}

	/**
	 * Verdict for a given destination. Order of checks:
	 *
	 * 1. Localhost aliases → always `allow` (still emitted to the
	 *    audit log via the caller, just no firewall blocking).
	 * 2. Allowlist hit (literal or wildcard) → `allow`.
	 * 3. Mode-driven default for unknown:
	 *    - `lockdown` → `deny`
	 *    - `log-only` → `allow` (audit only, no enforcement)
	 *    - `strict`   → `allow` for now (Phase 4C will queue a
	 *      toast prompt and return the user's choice via Promise)
	 *
	 * Returns sync because Phase 4A doesn't yet block on a user
	 * prompt; the signature is `Promise<Verdict>` so the toast-
	 * resolving path in Phase 4C plugs in without changing
	 * caller code.
	 */
	check(input: CheckInput): Promise<Verdict> {
		const host = input.host.toLowerCase()
		if (LOCALHOST_HOSTS.has(host)) return Promise.resolve('allow')
		if (this.matchAllowlist(host)) return Promise.resolve('allow')
		switch (this.mode) {
			case 'lockdown':
				logger.warn('PermissionService: denied (lockdown)', { host, port: input.port, source: input.source })
				return Promise.resolve('deny')
			case 'log-only':
			case 'strict':
			default:
				return Promise.resolve('allow')
		}
	}

	private matchAllowlist(host: string): boolean {
		if (this.allowlist.has(host)) return true
		// Wildcard: `*.example.com` matches `api.example.com` (one
		// label only). Multi-label support is intentionally out —
		// `*.com` would be foot-gunny on the security side.
		for (const pattern of this.allowlist) {
			if (!pattern.startsWith('*.')) continue
			const suffix = pattern.slice(1) // -> '.example.com'
			if (!host.endsWith(suffix)) continue
			const prefix = host.slice(0, host.length - suffix.length)
			if (prefix.length === 0) continue          // pattern parent — disallow
			if (prefix.includes('.')) continue         // multi-label — disallow
			return true
		}
		return false
	}
}

export const permissionService = new PermissionService()
