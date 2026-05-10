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
 * Plus a fourth narrow exemption for restorm's own infrastructure
 * ports on localhost (graphql bridge, Vite dev server, MCP) — see
 * `PermissionService` for the resolution.
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
	PROMPT_RESOLVE: 'firewall:prompt-resolve'
} as const

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
 * `internal` is reserved for Restorm's own renderer ↔ main bridge
 * traffic (the in-process GraphQL server). The console UI hides
 * internal calls by default so the user log isn't drowned in the
 * app's plumbing.
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

	/** Set by the renderer when the call comes from Restorm's own
	 * request execution path — links the record back to the
	 * persisted request the user can re-open via the console's
	 * click-through behaviour. */
	requestRefId?: string
}
