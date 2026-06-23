import { app, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { logger } from '../LoggerService'
import { FIREWALL_IPC, type FirewallOrigin, type FirewallPromptPayload } from '../../../types/firewall'
import { isFirewallE2EBypass } from './firewallConfig'

/**
 * Verdict the `PermissionService` returns. Strict / log-only / lockdown
 * are gone — there is one comportement, always-on prompting:
 *   - Origin is in the whitelist OR matches a project-derived origin
 *     OR is one of the host app's own infrastructure localhost ports →
 *     `allow` immediately.
 *   - Origin is in the blacklist → `deny` immediately, no prompt.
 *   - Otherwise → broadcast a toast prompt to the renderer; the
 *     promise resolves to `allow` (origin added to whitelist) or
 *     `deny` (origin added to blacklist).
 */
export type Verdict = 'allow' | 'deny'

/**
 * Synchronous classification of an origin. `allow` and `deny` resolve
 * without IPC; `prompt` means the caller has to either await the async
 * `check()` (Layer A) or buffer the request until the user responds
 * (Layer B's `BufferingClientRequest`). Splitting `classify()` from
 * `check()` lets Layer B make a fast synchronous decision and only
 * pay the cost of the async toast plumbing when the prompt is actually
 * needed.
 */
export type Classification = Verdict | 'prompt'

/**
 * Subset of `RequestRecord` the service needs to make a decision.
 * Keeps the call interface small + decouples from the full record
 * shape so we can decide without threading id / timestamp / etc.
 * through every code path that just wants "may I talk to this
 * scheme://host:port?".
 *
 * `originHint` is optional: when the caller has already walked the
 * V8 stack to identify "from npm package axios" or similar, threading
 * it here lets the toast prompt name the actual culprit instead of a
 * generic "main-http". Layer A passes the Chromium initiator URL via
 * the same field.
 */
export interface CheckInput {
	scheme: string
	host: string
	port: number
	source: string
	originHint?: string
}

/**
 * The host app's own infrastructure ports on localhost. Typical
 * occupants are an in-process renderer ↔ main bridge (GraphQL), a
 * dev server (Vite) in development, and an embedded MCP server — all
 * bound to `localhost:<port>` with ports picked at boot time. Any
 * traffic targeting these gets auto-allowed regardless of the
 * whitelist: they're internal plumbing the user can't disable. A
 * malicious package on `localhost:1234` does NOT benefit from this
 * exemption — the scope is restricted to the exact ports
 * `InfraPorts` holds at decision time. Slots the consuming app
 * doesn't use stay `null` (auto-allow disabled).
 */
export interface InfraPorts {
	graphqlPort: number | null
	mcpPort: number | null
	viteDevPort: number | null
}

/**
 * Persisted state shape. Both lists store the full origin triple so
 * `(http, foo.com, 80)` and `(https, foo.com, 443)` are distinct
 * decisions — the user can allow one and deny the other.
 */
interface PersistedState {
	whitelist: FirewallOrigin[]
	blacklist: FirewallOrigin[]
}

interface PendingPrompt {
	resolve: (verdict: Verdict) => void
	origin: FirewallOrigin
	timeoutHandle: NodeJS.Timeout
	source: string
	startedAt: string
	originHint?: string
}

/**
 * Read-only snapshot of a pending prompt — what the MCP layer
 * (and the firewall toast UI) needs to surface "the user has X
 * decisions waiting." `promptId` is the key callers pass back to
 * `resolvePrompt` to answer one programmatically.
 */
export interface PendingPromptSnapshot {
	promptId: string
	origin: FirewallOrigin
	source: string
	startedAt: string
	originHint?: string
}

/**
 * Auto-deny age for unanswered prompts. Without this an abandoned
 * prompt holds the originating request open forever (Layer A's
 * Chromium callback waits on the verdict promise). 60 seconds is
 * enough for the user to look + decide; the silent default is
 * `deny`, matching the conservative-default principle.
 */
const PROMPT_TIMEOUT_MS = 60_000

const LOCALHOST_HOSTS = new Set<string>(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'])

/**
 * The application-level protocols `detectWireProtocol` refines an outbound
 * request to (graphql / grpc / soap / odata) all ride the HTTP transport — but
 * the interceptor passes that refined label as the origin's `scheme`, while
 * project-derived origins (collectProjectOrigins) + user whitelist entries are
 * keyed by the TRANSPORT scheme (`http` / `https`). Without normalisation a
 * GraphQL/gRPC/SOAP/OData request to a project URL never matches its own
 * project origin (scheme `graphql` ≠ `http`) and prompts the firewall every
 * time — the symptom Yoann hit hosting a local GraphQL mock. Normalising the
 * app-protocol back to its transport (default `http`) before the host+port+
 * scheme compare fixes all four in one spot. This never WIDENS the boundary: a
 * `graphql` request over real HTTPS still carries an `https` project origin, so
 * normalising the request to `http` simply fails to match (→ prompt, the safe
 * default) rather than matching a stricter `https` entry.
 */
const APP_PROTOCOL_TRANSPORT = new Map<string, string>([
	['graphql', 'http'],
	['grpc', 'http'],
	['soap', 'http'],
	['odata', 'http']
])

/** Map a refined app-protocol scheme back to its transport scheme for
 * origin-matching; transport schemes (http/https/ws/wss/…) pass through. */
function transportScheme(scheme: string): string {
	return APP_PROTOCOL_TRANSPORT.get(scheme) ?? scheme
}

/**
 * Reserved sentinel for port wildcards. `0` is never a real service
 * port (kernel allocates ephemeral ports starting at 32768+), so we
 * use it as the "match any port" marker without inventing a separate
 * field on `FirewallOrigin`. The renderer parses `:*` in the input
 * to this value when adding a wildcard entry.
 */
const WILDCARD_PORT = 0

/**
 * Reject host patterns the user shouldn't be allowed to add: empty,
 * leading dots, multiple stars, stars not at the leading position,
 * or stars without the matching `*.` prefix. The matching logic in
 * `matches()` is deliberately narrow — let users add only the forms
 * the matcher actually understands.
 */
function isValidHostPattern(host: string): boolean {
	if (host.length === 0) return false
	if (host === '*') return false
	if (host.startsWith('*.')) {
		const rest = host.slice(2)
		if (rest.length === 0) return false
		if (rest.includes('*')) return false
		if (rest.startsWith('.') || rest.endsWith('.')) return false
		return true
	}
	if (host.includes('*')) return false
	return true
}

class PermissionService {
	private readonly whitelist: FirewallOrigin[] = []
	private readonly blacklist: FirewallOrigin[] = []

	/**
	 * Origins extracted from the open project's request URLs (after
	 * env-var / Handlebars resolution). Pushed by the renderer on
	 * every project change. Not persisted — re-derived from
	 * project state every time the renderer mounts. Used as the
	 * second source of truth in the verdict resolution.
	 */
	private projectOrigins: FirewallOrigin[] = []

	/**
	 * The host app's own infrastructure ports. Populated by the
	 * consuming app on boot (graphql, vite-dev) and after any embedded
	 * MCP server starts (mcp). The three are read at every check; if
	 * any becomes `null` the matching auto-allow is disabled.
	 */
	private infraPorts: InfraPorts = { graphqlPort: null, mcpPort: null, viteDevPort: null }

	/**
	 * Pending toast prompts keyed by promptId. The renderer
	 * resolves each one via `resolvePrompt(promptId, verdict)`. We
	 * dedupe in-flight prompts by origin: a flurry of subresource
	 * loads to the same destination only triggers one toast — the
	 * verdict fans back out to every queued waiter on resolution.
	 */
	private readonly pendingPrompts = new Map<string, PendingPrompt>()
	private readonly promptByOrigin = new Map<string, string>()
	private readonly waitersByOrigin = new Map<string, ((v: Verdict) => void)[]>()

	private loaded = false
	private statePath: string | null = null

	private resolvePath(): string {
		if (this.statePath !== null) return this.statePath
		const base = app.getPath('userData')
		this.statePath = join(base, 'firewall', 'state.json')
		return this.statePath
	}

	private loadIfNeeded(): void {
		if (this.loaded) return
		this.loaded = true
		const path = this.resolvePath()
		if (!existsSync(path)) return
		try {
			const raw = readFileSync(path, 'utf8')
			const parsed = JSON.parse(raw) as Partial<PersistedState>
			if (Array.isArray(parsed.whitelist)) {
				this.whitelist.length = 0
				for (const o of parsed.whitelist) {
					const norm = this.normaliseOrigin(o)
					if (norm !== null) this.whitelist.push(norm)
				}
			}
			if (Array.isArray(parsed.blacklist)) {
				this.blacklist.length = 0
				for (const o of parsed.blacklist) {
					const norm = this.normaliseOrigin(o)
					if (norm !== null) this.blacklist.push(norm)
				}
			}
			logger.info('PermissionService: loaded persisted state', {
				whitelistSize: this.whitelist.length,
				blacklistSize: this.blacklist.length
			})
		} catch (err) {
			logger.warn('PermissionService: failed to load persisted state', { path, error: String(err) })
		}
	}

	private persist(): void {
		try {
			const path = this.resolvePath()
			mkdirSync(dirname(path), { recursive: true })
			const state: PersistedState = {
				whitelist: this.whitelist.slice().sort(originOrder),
				blacklist: this.blacklist.slice().sort(originOrder)
			}
			writeFileSync(path, JSON.stringify(state, null, 2), 'utf8')
		} catch (err) {
			logger.warn('PermissionService: failed to persist state', { error: String(err) })
		}
	}

	private normaliseOrigin(o: unknown): FirewallOrigin | null {
		if (typeof o !== 'object' || o === null) return null
		const raw = o as { scheme?: unknown; host?: unknown; port?: unknown }
		if (typeof raw.scheme !== 'string' || typeof raw.host !== 'string' || typeof raw.port !== 'number') return null
		const scheme = raw.scheme.toLowerCase()
		const host = raw.host.toLowerCase()
		const port = Math.trunc(raw.port)
		if (!isValidHostPattern(host)) return null
		if (port !== WILDCARD_PORT && (!Number.isFinite(port) || port < 0 || port > 65535)) return null
		return { scheme, host, port }
	}

	private equals(a: FirewallOrigin, b: FirewallOrigin): boolean {
		return a.scheme === b.scheme && a.host === b.host && a.port === b.port
	}

	/**
	 * Match a candidate origin against a list entry. Supports two glob
	 * forms — both deliberately narrow:
	 *
	 *   - **Host**: `*.example.com` matches exactly ONE subdomain
	 *     level. `api.example.com` matches; `example.com` does NOT
	 *     (no zero-level match — the user has to add the bare domain
	 *     separately if they want it); `a.b.example.com` does NOT
	 *     match (no eager glob — explicit by design).
	 *
	 *   - **Port**: `0` is reserved as the wildcard port (no real
	 *     service runs on port 0). An entry with `port: 0` matches
	 *     any port.
	 *
	 *   - **Scheme**: always exact-match. Adding a scheme wildcard
	 *     would let a `https`-only allowance silently grant `http`
	 *     too, which is too easy to mis-use.
	 */
	private matches(entry: FirewallOrigin, origin: FirewallOrigin): boolean {
		if (entry.scheme !== origin.scheme) return false
		if (entry.port !== WILDCARD_PORT && entry.port !== origin.port) return false
		if (entry.host === origin.host) return true
		if (entry.host.startsWith('*.')) {
			const suffix = entry.host.slice(2)
			// `*.example.com` matches `api.example.com` but NOT
			// `example.com` (no zero-subdomain match) and NOT
			// `a.b.example.com` (no multi-subdomain match).
			if (!origin.host.endsWith(`.${suffix}`)) return false
			const head = origin.host.slice(0, origin.host.length - suffix.length - 1)
			if (head.length === 0) return false
			if (head.includes('.')) return false
			return true
		}
		return false
	}

	private contains(list: FirewallOrigin[], origin: FirewallOrigin): boolean {
		for (const entry of list) if (this.matches(entry, origin)) return true
		return false
	}

	listWhitelist(): FirewallOrigin[] {
		this.loadIfNeeded()
		return this.whitelist.slice().sort(originOrder)
	}

	listBlacklist(): FirewallOrigin[] {
		this.loadIfNeeded()
		return this.blacklist.slice().sort(originOrder)
	}

	addToWhitelist(origin: FirewallOrigin): void {
		this.loadIfNeeded()
		const norm = this.normaliseOrigin(origin)
		if (norm === null) return
		if (this.contains(this.whitelist, norm)) return
		this.whitelist.push(norm)
		// Promoting to whitelist also clears any matching blacklist
		// entry — the user is reversing a previous deny.
		const idx = this.blacklist.findIndex((e) => this.equals(e, norm))
		if (idx !== -1) this.blacklist.splice(idx, 1)
		this.persist()
	}

	removeFromWhitelist(origin: FirewallOrigin): void {
		this.loadIfNeeded()
		const norm = this.normaliseOrigin(origin)
		if (norm === null) return
		const idx = this.whitelist.findIndex((e) => this.equals(e, norm))
		if (idx !== -1) {
			this.whitelist.splice(idx, 1)
			this.persist()
		}
	}

	addToBlacklist(origin: FirewallOrigin): void {
		this.loadIfNeeded()
		const norm = this.normaliseOrigin(origin)
		if (norm === null) return
		if (this.contains(this.blacklist, norm)) return
		this.blacklist.push(norm)
		// Symmetric: a fresh deny clears any matching whitelist entry.
		const idx = this.whitelist.findIndex((e) => this.equals(e, norm))
		if (idx !== -1) this.whitelist.splice(idx, 1)
		this.persist()
	}

	removeFromBlacklist(origin: FirewallOrigin): void {
		this.loadIfNeeded()
		const norm = this.normaliseOrigin(origin)
		if (norm === null) return
		const idx = this.blacklist.findIndex((e) => this.equals(e, norm))
		if (idx !== -1) {
			this.blacklist.splice(idx, 1)
			this.persist()
		}
	}

	/**
	 * Replace the project-derived origins set in one shot. Called by
	 * the renderer's `useProjectOriginsSync` hook on every project
	 * tree change. Not persisted — re-derived from project state.
	 */
	setProjectOrigins(origins: FirewallOrigin[]): void {
		const next: FirewallOrigin[] = []
		for (const o of origins) {
			const norm = this.normaliseOrigin(o)
			if (norm !== null) next.push(norm)
		}
		this.projectOrigins = next
	}

	/**
	 * Update the host app's internal port set. Called once per port at
	 * app boot (graphql, vite-dev) and once when any embedded MCP
	 * server starts (mcp). Setting any field to `null` disables the
	 * corresponding auto-allow.
	 */
	setInfraPorts(patch: Partial<InfraPorts>): void {
		this.infraPorts = { ...this.infraPorts, ...patch }
	}

	getInfraPorts(): InfraPorts {
		return { ...this.infraPorts }
	}

	/**
	 * True if the origin is `localhost:<port>` and `<port>` matches
	 * one of the host app's known infrastructure ports. Localhost on
	 * any other port is NOT auto-allowed — this is a deliberately
	 * narrow exception for the app's own plumbing.
	 */
	private isInfraOrigin(origin: FirewallOrigin): boolean {
		if (!LOCALHOST_HOSTS.has(origin.host)) return false
		const { graphqlPort, mcpPort, viteDevPort } = this.infraPorts
		return origin.port === graphqlPort || origin.port === mcpPort || origin.port === viteDevPort
	}

	/**
	 * Synchronous classification — same gates as `check()` but never
	 * triggers the toast IPC. `prompt` means the destination is
	 * unknown and the caller has to decide what to do: Layer A awaits
	 * `check()` for the async resolution; Layer B parks the request
	 * in a `BufferingClientRequest` until the matching `check()` call
	 * resolves.
	 */
	classify(input: CheckInput): Classification {
		if (isFirewallE2EBypass()) return 'allow'
		this.loadIfNeeded()
		const origin: FirewallOrigin = {
			scheme: transportScheme(input.scheme.toLowerCase()),
			host: input.host.toLowerCase(),
			port: input.port
		}
		if (origin.host === '') return 'allow'
		if (this.isInfraOrigin(origin)) return 'allow'
		if (this.contains(this.whitelist, origin)) return 'allow'
		if (this.contains(this.projectOrigins, origin)) return 'allow'
		if (this.contains(this.blacklist, origin)) {
			logger.warn('PermissionService: denied (blacklist)', { origin, source: input.source })
			return 'deny'
		}
		return 'prompt'
	}

	check(input: CheckInput): Promise<Verdict> {
		const cls = this.classify(input)
		if (cls === 'allow' || cls === 'deny') return Promise.resolve(cls)
		const origin: FirewallOrigin = {
			scheme: transportScheme(input.scheme.toLowerCase()),
			host: input.host.toLowerCase(),
			port: input.port
		}
		return this.requestPrompt(origin, input.source, input.originHint)
	}

	private originKey(origin: FirewallOrigin): string {
		return `${origin.scheme}://${origin.host}:${String(origin.port)}`
	}

	private requestPrompt(origin: FirewallOrigin, source: string, originHint?: string): Promise<Verdict> {
		const key = this.originKey(origin)
		const existing = this.promptByOrigin.get(key)
		if (existing !== undefined) {
			return new Promise<Verdict>((resolve) => {
				const queue = this.waitersByOrigin.get(key) ?? []
				queue.push(resolve)
				this.waitersByOrigin.set(key, queue)
			})
		}
		const promptId = randomUUID()
		const promise = new Promise<Verdict>((resolve) => {
			const timeoutHandle = setTimeout(() => {
				logger.warn('PermissionService: prompt timed out (auto-deny, not persisted)', { promptId, origin, source, timeoutMs: PROMPT_TIMEOUT_MS })
				// `persist: false` — the user didn't actually answer, so
				// treating silence as a permanent "block forever" is
				// hostile UX. Deny THIS request, leave the rule lists
				// untouched, and the next outbound call to the same
				// origin gets a fresh prompt.
				this.resolvePrompt(promptId, 'deny', false)
			}, PROMPT_TIMEOUT_MS)
			timeoutHandle.unref()
			const pending: PendingPrompt = {
				resolve,
				origin,
				timeoutHandle,
				source,
				startedAt: new Date().toISOString()
			}
			if (originHint !== undefined && originHint !== '') pending.originHint = originHint
			this.pendingPrompts.set(promptId, pending)
		})
		this.promptByOrigin.set(key, promptId)
		const payload: FirewallPromptPayload = {
			promptId,
			origin,
			source: source as FirewallPromptPayload['source'],
			timestamp: new Date().toISOString(),
			...(originHint !== undefined && originHint !== '' ? { originHint } : {})
		}
		const targets = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
		if (targets.length === 0) {
			logger.warn('PermissionService: no renderer window for prompt — auto-denying (not persisted)', { promptId, origin, source })
			// Same rationale as the timeout path: no renderer = no user
			// signal = don't persist the silence into the blacklist.
			queueMicrotask(() => { this.resolvePrompt(promptId, 'deny', false) })
			return promise
		}
		for (const win of targets) win.webContents.send(FIREWALL_IPC.PROMPT_SHOW, payload)
		return promise
	}

	/**
	 * Resolve a pending prompt. `persist` defaults to `true` — meaning
	 * the verdict gets recorded into the matching list so future calls
	 * to the same origin short-circuit. Pass `false` for synthetic
	 * resolutions (timeout, no-renderer, before-quit cleanup) where the
	 * user didn't actually click — those should resolve the current
	 * request without writing a forever-rule on their behalf.
	 */
	resolvePrompt(promptId: string, verdict: Verdict, persist = true): void {
		this.loadIfNeeded()
		const pending = this.pendingPrompts.get(promptId)
		if (pending === undefined) {
			logger.debug('PermissionService: resolvePrompt called for unknown id', { promptId })
			return
		}
		clearTimeout(pending.timeoutHandle)
		const key = this.originKey(pending.origin)
		this.pendingPrompts.delete(promptId)
		this.promptByOrigin.delete(key)
		if (persist) {
			// Persist the user's decision into the matching list. Allow
			// → whitelist; deny → blacklist. Both lists' add* methods
			// dedupe + write through to disk.
			if (verdict === 'allow') this.addToWhitelist(pending.origin)
			else this.addToBlacklist(pending.origin)
		}
		pending.resolve(verdict)
		const waiters = this.waitersByOrigin.get(key)
		if (waiters !== undefined) {
			this.waitersByOrigin.delete(key)
			for (const resolve of waiters) resolve(verdict)
		}
	}

	/**
	 * Auto-deny every outstanding prompt — wired to `before-quit` in
	 * `main/index.ts` so a shutdown mid-prompt doesn't leave the IPC
	 * bridge with dangling Promises that the renderer can never
	 * resolve. Idempotent.
	 */
	/**
	 * Snapshot of every prompt currently awaiting a user decision.
	 * Returned in insertion order (oldest first) so the caller can
	 * show "X has been waiting longer than Y." Empty when no
	 * prompt is in flight.
	 */
	listPendingPrompts(): PendingPromptSnapshot[] {
		const out: PendingPromptSnapshot[] = []
		for (const [promptId, p] of this.pendingPrompts) {
			const snap: PendingPromptSnapshot = {
				promptId,
				origin: { ...p.origin },
				source: p.source,
				startedAt: p.startedAt
			}
			if (p.originHint !== undefined) snap.originHint = p.originHint
			out.push(snap)
		}
		return out
	}

	denyAllPending(): void {
		const ids = Array.from(this.pendingPrompts.keys())
		// `persist: false` — shutdown isn't a user decision; the next
		// boot starts with the same rules the user had before quitting.
		for (const promptId of ids) this.resolvePrompt(promptId, 'deny', false)
	}
}

function originOrder(a: FirewallOrigin, b: FirewallOrigin): number {
	if (a.host !== b.host) return a.host < b.host ? -1 : 1
	if (a.port !== b.port) return a.port - b.port
	return a.scheme < b.scheme ? -1 : a.scheme > b.scheme ? 1 : 0
}

export const permissionService = new PermissionService()
