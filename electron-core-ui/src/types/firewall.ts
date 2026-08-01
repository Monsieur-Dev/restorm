/*
 * Firewall + console feed — shared shape between main and renderer.
 *
 * Both interception layers (Chromium webRequest in the renderer
 * session, monkey-patched http/https/fetch in the main process) emit
 * `RequestRecord` objects via the IPC channel below. The renderer's
 * console workbench tab subscribes and renders each record as a
 * shell-style line; the firewall's audit log persists denied entries
 * for the settings panel. Single shape keeps everything aligned.
 *
 * The object MUST stay JSON-serialisable: no class instances, no
 * `Date` (use ISO strings), no `Buffer` (use base64 strings if a body
 * is binary). Electron's IPC structured-clone is used for transport.
 */

/**
 * IPC channel name for `RequestRecord` broadcasts. Main → renderer.
 * The console subscribes; the audit log builds itself off the same
 * stream by aggregating in the main process before relaying.
 */
export const FIREWALL_REQUEST_RECORD_CHANNEL = 'firewall:request-record'

/**
 * Origin triple the firewall checks every outbound call against.
 * Three sources of truth for "is this destination known":
 *
 *   1. Explicit user whitelist (persisted, editable from the
 *      Firewall panel).
 *   2. Auto-derived from the open project — every URL in every
 *      request, resolved through env vars / Handlebars, broken
 *      down to its (scheme, host, port). The renderer pushes this
 *      set to main on every project change.
 *   3. Explicit user blacklist (persisted, editable).
 *
 * Plus a fourth narrow exemption for the host app's own
 * infrastructure ports on localhost (e.g. a GraphQL bridge, a Vite
 * dev server, an embedded MCP server) — see `PermissionService` for
 * the resolution.
 *
 * Origins are normalised on insert: scheme + host lower-cased, port
 * numeric (defaulted from the scheme when absent — 80 / 443 / 80 /
 * 443 / 80 for http / https / ws / wss / unknown). Pure JSON to
 * survive structured-clone over IPC.
 */
export interface FirewallOrigin {
	scheme: string
	host: string
	port: number
}

/**
 * Renderer ↔ main control-plane channels. The renderer wraps these in
 * `window.api.firewall.*` (see preload). Main installs the handlers
 * via `registerFirewallIpc` at boot.
 */
export const FIREWALL_IPC = {
	LIST_WHITELIST: 'firewall:list-whitelist',
	ADD_WHITELIST: 'firewall:add-whitelist',
	REMOVE_WHITELIST: 'firewall:remove-whitelist',
	LIST_BLACKLIST: 'firewall:list-blacklist',
	ADD_BLACKLIST: 'firewall:add-blacklist',
	REMOVE_BLACKLIST: 'firewall:remove-blacklist',
	SET_PROJECT_ORIGINS: 'firewall:set-project-origins',
	PROMPT_SHOW: 'firewall:prompt-show',
	PROMPT_RESOLVE: 'firewall:prompt-resolve',
	/** Read-only: the app's OWN outbound destinations (see
	 * {@link SystemEndpointStatus}). No mutating counterpart by design — these
	 * are declared in code, not editable by the user. Introspection for tests
	 * and diagnostics. */
	LIST_SYSTEM_ENDPOINTS: 'firewall:list-system-endpoints',
	/** Read-only: the hosts currently in the system allowlist — the actual input
	 * to the permission check, as opposed to the descriptive declarations above.
	 * Introspection for tests and diagnostics. */
	LIST_SYSTEM_ALLOWED_HOSTS: 'firewall:list-system-allowed-hosts',
	/** Main → renderer push: the declared endpoints or their live state moved
	 * (consent granted / revoked, a host resolved on login). Carries no payload
	 * — a listener re-reads via {@link FIREWALL_IPC.LIST_SYSTEM_ENDPOINTS}, so a
	 * burst of changes collapses into one authoritative read. */
	SYSTEM_ENDPOINTS_CHANGED: 'firewall:system-endpoints-changed'
} as const

/**
 * How a system endpoint escapes the user firewall. Two mechanisms exist and
 * they behave differently enough that the UI must distinguish them:
 *
 *   - `system-allowlist` — the host is registered in `PermissionService`'s
 *     system allowlist (in-memory, not user-deletable). The exemption is only
 *     live while the host is registered, which is how a consent-gated endpoint
 *     switches off: revoke consent, the host is dropped, and the firewall goes
 *     back to prompting for it.
 *   - `call-scoped-bypass` — no host is allow-listed at all; a specific guarded
 *     fetch opens an `AsyncLocalStorage` bypass around its own call-chain
 *     (`withFirewallBypass`). Narrower than an allowlist entry (only THAT code
 *     path is exempt), but it never appears in the allowlist, which is exactly
 *     why it needs declaring here — otherwise it is invisible traffic.
 */
export type SystemEndpointExemption = 'system-allowlist' | 'call-scoped-bypass'

/**
 * One outbound destination the APPLICATION ITSELF contacts — as opposed to the
 * user's own API traffic, which the whitelist / blacklist govern.
 *
 * Declaring these makes the app's "phone home" surface auditable: the inventory
 * names every host the app may reach on its own initiative, why, and whether it
 * is currently live, and is readable over
 * {@link FIREWALL_IPC.LIST_SYSTEM_ENDPOINTS}. An exemption that isn't declared
 * here is an exemption nobody can audit, which is the failure mode this type
 * exists to prevent.
 */
export interface SystemEndpointDeclaration {
	/** Stable id, unique per app (`'backend'`, `'avatar'`, `'crash'`, …). Also
	 * the upsert key: re-declaring the same id replaces the entry. */
	id: string
	/** EXACT host — never a wildcard, never a pattern. `null` when the host is
	 * not resolved yet (a signed-out avatar CDN, an unconfigured endpoint); the
	 * row still renders, marked inactive. */
	host: string | null
	/** Key describing WHY this host is contacted, resolvable against the host
	 * app's i18n catalogue — no English is baked into the declaration. Nothing
	 * in the library renders it; it labels the entry for whatever surfaces the
	 * inventory. */
	purposeKey: string
	/** Id of the consent gate governing it (`'telemetry'`, …), or `null` when
	 * the endpoint needs no consent (the licensing backend the app cannot work
	 * without). */
	consentGate: string | null
	/** Which mechanism exempts it. */
	exemption: SystemEndpointExemption
}

/** A declaration plus its live state, as returned over
 * {@link FIREWALL_IPC.LIST_SYSTEM_ENDPOINTS}. */
export interface SystemEndpointStatus extends SystemEndpointDeclaration {
	/**
	 * `true` when the endpoint may currently be reached without a firewall
	 * prompt. For `system-allowlist` this is computed from the live allowlist
	 * (so a revoked consent shows `false` immediately); for
	 * `call-scoped-bypass` it means the host is resolved and its guarded fetch
	 * is wired.
	 */
	active: boolean
}

/**
 * Payload broadcast main → renderer when an unknown destination
 * needs the user's call. The renderer renders the prompt as a
 * toast with two buttons (Allow / Deny); the choice resolves the
 * pending verdict + adds the origin to the matching list (Allow →
 * whitelist, Deny → blacklist).
 */
export interface FirewallPromptPayload {
	/** Stable id used by the renderer to send the resolution back. */
	promptId: string
	/** Destination origin — full triple. Toast displays `host:port`
	 * (with scheme prefix when non-default) so the user can tell
	 * which call is being prompted. */
	origin: FirewallOrigin
	/** Layer that captured the call. */
	source: RequestRecordSource
	/** Capture time — ISO timestamp. */
	timestamp: string
	/** Best-effort identification of the caller — for Layer A this is
	 * the Chromium initiator URL; for Layer B it's a stack-trace walk
	 * naming the originating npm package or first-party module. The
	 * toast renders this on a secondary line ("from npm package
	 * `axios`") so the user can answer the always-implicit question
	 * "*who* is trying to talk to that destination". Optional —
	 * absent when the layer couldn't attribute the call. */
	originHint?: string
}

/**
 * Resolution payload sent renderer → main when the user picks one of
 * the two toast buttons. `Allow` adds the origin to the whitelist
 * and lets the request through; `Deny` adds it to the blacklist and
 * fails the request. Both decisions persist to disk.
 */
export interface FirewallPromptResolution {
	promptId: string
	verdict: 'allow' | 'deny'
}

/**
 * Origin layer that captured the request. Used by the console UI to
 * tag the source ("from renderer fetch" vs "from main http") and by
 * the firewall's stack-trace capture to know whether to walk the
 * V8 stack or the Chromium initiator chain.
 */
export type RequestRecordSource = 'renderer-webrequest' | 'main-http' | 'main-https' | 'main-fetch' | 'main-net' | 'main-dns'

/**
 * Verdict the PermissionService returned (or `pending` while the
 * toast is still open and the call is buffered). Both layers emit
 * one record per call: the initial one carries `pending` (or `allow`
 * for fast-path allowlist hits), and a follow-up patches the same
 * `id` with the final verdict + status / duration once the request
 * lands.
 */
export type RequestRecordVerdict = 'allow' | 'deny' | 'pending'

/**
 * Wire-protocol category. The firewall blocks on destination, not
 * content, but the console's format renderer needs to know whether
 * to emit `curl`, `grpcurl`, `wscat`, etc.
 *
 * `internal` is reserved for the host app's own renderer ↔ main
 * bridge traffic (e.g. an in-process GraphQL server). The console UI
 * hides internal calls by default so the user log isn't drowned in
 * the app's plumbing.
 */
export type RequestRecordProtocol = 'http' | 'https' | 'graphql' | 'grpc' | 'soap' | 'odata' | 'websocket' | 'internal'

/**
 * Single intercepted call. Emitted once on capture and (optionally)
 * once again on completion to patch in `status` / `durationMs` /
 * `errorMessage` — the renderer keys updates by `id`.
 */
export interface RequestRecord {
	/** Stable identifier — UUID minted at interception time. The
	 * console uses it for click-through to the source request and
	 * for matching the completion patch to its initial record. */
	id: string

	/** ISO-8601 timestamp of the capture. Use a string (not `Date`)
	 * so the object survives `structuredClone` over IPC unchanged. */
	timestamp: string

	/** Layer that captured the call. Drives the source label in the
	 * console ("renderer fetch" vs "main http") and informs the
	 * stack-trace capture path on the main side. */
	source: RequestRecordSource

	/** Wire-protocol category. Drives the format renderer in the
	 * console; `internal` is filtered from the user-facing log by
	 * default. */
	protocol: RequestRecordProtocol

	/** HTTP method (or pseudo-method for non-HTTP protocols —
	 * `INVOKE` for gRPC, `CONNECT` for WebSocket). */
	method: string

	/** Full URL the caller asked for, BEFORE any rewriting. May
	 * include query params. The firewall's destination check uses
	 * the parsed `host` field below — `url` is preserved for the
	 * console renderer. */
	url: string

	/** Hostname / IP literal the firewall checks against the
	 * allowlist. Lower-cased; IPv6 without brackets. */
	host: string

	/** Numeric port. Defaulted (`80` / `443` / `21` / …) when the
	 * URL didn't carry one explicitly. */
	port: number

	/** Captured request headers, lower-cased keys. Authorization
	 * headers are PRESERVED here (the console + audit log are
	 * trusted surfaces, both inside the user's process); the
	 * format renderer is responsible for redacting on display when
	 * the user opts in. */
	headers: Record<string, string>

	/** Request body, when present. Strings for text bodies, base64
	 * for binary (the format renderer decides whether to inline
	 * the bytes or render a `--data-binary @<file>` placeholder). */
	body?: string

	/** Latest known verdict for this record. `pending` only appears
	 * when the firewall is in `strict` mode and the toast prompt is
	 * waiting on the user; the same `id` re-emits with `allow` /
	 * `deny` once the user picks. */
	verdict: RequestRecordVerdict

	/** HTTP status (or wire-protocol equivalent). Set on the
	 * completion patch, not on the initial capture. */
	status?: number

	/** Total time from capture to completion, in ms. Set on the
	 * completion patch. */
	durationMs?: number

	/** Set on completion if the request errored out (network reset,
	 * deny, abort, …). Pairs with `verdict: 'deny'` for blocked
	 * calls so the console can label them clearly. */
	errorMessage?: string

	/** Optional human-readable origin hint ("from
	 * `HTTPExecutionService`", "from npm package `axios`" via
	 * stack walk). Set by the main-side patch when available; the
	 * renderer-side webRequest layer uses Chromium's `initiator`
	 * URL instead. */
	originHint?: string

	/** Set by the renderer when the call comes from the host app's own
	 * request execution path — links the record back to the
	 * persisted request the user can re-open via the console's
	 * click-through behaviour. */
	requestRefId?: string
}
