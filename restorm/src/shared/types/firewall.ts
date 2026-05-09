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
 * Mode of the firewall — duplicated here in shared so the renderer
 * settings panel can reference it without reaching into main.
 */
export type FirewallMode = 'strict' | 'log-only' | 'lockdown'

/**
 * Renderer ↔ main control-plane channels. The renderer wraps these in
 * `window.api.firewall.*` (see preload). Main installs the handlers
 * via `registerFirewallIpc` at boot.
 */
export const FIREWALL_IPC = {
	GET_MODE: 'firewall:get-mode',
	SET_MODE: 'firewall:set-mode',
	LIST_ALLOWLIST: 'firewall:list-allowlist',
	ADD_ALLOWLIST: 'firewall:add-allowlist',
	REMOVE_ALLOWLIST: 'firewall:remove-allowlist',
	PROMPT_SHOW: 'firewall:prompt-show',
	PROMPT_RESOLVE: 'firewall:prompt-resolve'
} as const

/**
 * Payload broadcast main → renderer when strict mode hits an unknown
 * destination and needs the user's call. The renderer renders the
 * prompt as a toast with four action buttons; clicking any one
 * resolves the pending verdict via `FIREWALL_IPC.PROMPT_RESOLVE`.
 */
export interface FirewallPromptPayload {
	/** Stable id used by the renderer to send the resolution back. */
	promptId: string
	/** Destination — same triple PermissionService used to make the
	 * decision. The toast displays `host:port` so the user can tell
	 * which call is being prompted. */
	host: string
	port: number
	/** Layer that captured the call. Used by the toast to colour /
	 * label the prompt ("renderer fetch" vs "main http"). */
	source: RequestRecordSource
	/** Capture time — ISO timestamp; the toast renders a relative-
	 * time hint so stale prompts (renderer was hidden, user just
	 * came back) are obvious. */
	timestamp: string
}

/**
 * Resolution payload sent renderer → main when the user picks one of
 * the toast buttons. `persist: true` adds the host to the allowlist
 * (for `verdict: 'allow'`) or to the denylist (for `verdict: 'deny'`,
 * Phase 5+; today the deny side just suppresses repeated prompts for
 * the rest of the session via the in-memory promptlist).
 */
export interface FirewallPromptResolution {
	promptId: string
	verdict: 'allow' | 'deny'
	persist: boolean
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
