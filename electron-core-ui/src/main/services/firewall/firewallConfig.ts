/**
 * Generic, app-injected firewall configuration.
 *
 * The firewall engine is reusable across any Electron app. The few
 * decisions that depend on the host app — which internal endpoint to
 * skip from the audit feed, the worker-bootstrap temp-file prefix,
 * and whether an environment-driven test bypass is active — are NOT
 * baked in. The consuming app injects them once at boot via
 * `configureFirewall`; everything reads them through the helpers here.
 *
 * All fields are optional and default to a safe, app-agnostic value,
 * so a consumer that calls nothing still gets a working firewall
 * (no internal-endpoint skip, no bypass, generic temp prefix).
 */

export interface FirewallConfig {
	/**
	 * Returns the URL of an in-process bridge endpoint that should be
	 * skipped from interception + the audit feed (e.g. a renderer ↔
	 * main GraphQL bridge that would otherwise drown the log in
	 * internal chatter). Called on every check, so a port that changes
	 * between boots is picked up automatically. When unset, no endpoint
	 * is treated as internal — the generic firewall makes no assumption
	 * that such a bridge exists.
	 */
	internalEndpointProvider?: (() => string) | null
	/**
	 * When `true`, every outbound call is auto-allowed. Intended for
	 * end-to-end test harnesses that boot the app against ephemeral
	 * mock servers on ports that can never be whitelisted ahead of
	 * time. The consuming app resolves this once (usually from an env
	 * var its test fixture sets) and passes the boolean here. Default
	 * `false`.
	 */
	e2eBypass?: boolean
	/**
	 * Filename prefix for the worker / fork firewall-bootstrap script
	 * written to `os.tmpdir()`. Defaults to `ecui-firewall-bootstrap`.
	 * Apps that want the file to carry their own name can override it.
	 */
	workerBootstrapPrefix?: string
	/**
	 * Predicate over the raw `http.request` / `https.request` argument
	 * list that flags a request as internal infrastructure the host app
	 * generates between its own processes/instances (e.g. a loopback
	 * call carrying an app-private routing header). When it returns
	 * `true` the firewall exempts the request — auto-`allow`, emit for
	 * audit, forward straight to the real transport — without a verdict
	 * roundtrip or a user prompt. Receives the same argument array the
	 * interceptor saw, so the app can inspect headers/URL itself. When
	 * unset, no request is treated as internal — the generic engine
	 * makes no assumption that such traffic exists.
	 */
	internalRequestPredicate?: ((args: unknown[]) => boolean) | null
}

interface ResolvedFirewallConfig {
	internalEndpointProvider: (() => string) | null
	e2eBypass: boolean
	workerBootstrapPrefix: string
	internalRequestPredicate: ((args: unknown[]) => boolean) | null
}

const DEFAULT_CONFIG: ResolvedFirewallConfig = {
	internalEndpointProvider: null,
	e2eBypass: false,
	workerBootstrapPrefix: 'ecui-firewall-bootstrap',
	internalRequestPredicate: null
}

let current: ResolvedFirewallConfig = { ...DEFAULT_CONFIG }

/**
 * Inject the host app's firewall configuration. Merges over the
 * current config — call it once at boot, before any interceptor is
 * installed, though later calls are safe (each reads the live config
 * at decision time). Passing `internalEndpointProvider: null`
 * explicitly clears a previously-set provider.
 */
export function configureFirewall(config: FirewallConfig): void {
	if ('internalEndpointProvider' in config) {
		current.internalEndpointProvider = config.internalEndpointProvider ?? null
	}
	if (config.e2eBypass !== undefined) current.e2eBypass = config.e2eBypass
	if (config.workerBootstrapPrefix !== undefined && config.workerBootstrapPrefix !== '') {
		current.workerBootstrapPrefix = config.workerBootstrapPrefix
	}
	if ('internalRequestPredicate' in config) {
		current.internalRequestPredicate = config.internalRequestPredicate ?? null
	}
}

/** Reset to defaults. Test-only convenience. */
export function resetFirewallConfig(): void {
	current = { ...DEFAULT_CONFIG }
}

export function isFirewallE2EBypass(): boolean {
	return current.e2eBypass
}

export function getWorkerBootstrapPrefix(): string {
	return current.workerBootstrapPrefix
}

/**
 * True when `rawUrl` matches the app-injected internal bridge endpoint
 * (host match + the bridge's path or a sub-path of it). Always `false`
 * when no provider was injected, so the generic engine never skips a
 * real user destination by accident.
 */
export function isInternalEndpoint(rawUrl: string): boolean {
	const provider = current.internalEndpointProvider
	if (provider === null) return false
	try {
		const requested = new URL(rawUrl)
		const internal = new URL(provider())
		if (requested.host !== internal.host) return false
		return requested.pathname === internal.pathname || requested.pathname.startsWith(`${internal.pathname}/`)
	} catch {
		return false
	}
}

/**
 * True when the app-injected predicate flags this raw request-argument
 * list as internal infrastructure traffic to exempt from the firewall.
 * Always `false` when no predicate was injected, and never throws — a
 * predicate that throws is treated as "not internal" so a buggy host
 * hook can't crash the interceptor.
 */
export function isInternalRequest(args: unknown[]): boolean {
	const predicate = current.internalRequestPredicate
	if (predicate === null) return false
	try {
		return predicate(args)
	} catch {
		return false
	}
}
