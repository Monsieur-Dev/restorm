import { app, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { logger } from 'electron-core-ui'
import { FIREWALL_IPC, type FirewallOrigin, type FirewallPromptPayload } from '../../../shared/types/firewall'

/**
 * Verdict the `PermissionService` returns. Strict / log-only / lockdown
 * are gone — there is one comportement, always-on prompting:
 *   - Origin is in the whitelist OR matches a project-derived origin
 *     OR is one of restorm's own infrastructure localhost ports →
 *     `allow` immediately.
 *   - Origin is in the blacklist → `deny` immediately, no prompt.
 *   - Otherwise → broadcast a toast prompt to the renderer; the
 *     promise resolves to `allow` (origin added to whitelist) or
 *     `deny` (origin added to blacklist).
 */
export type Verdict = 'allow' | 'deny'

/**
 * Subset of `RequestRecord` the service needs to make a decision.
 * Keeps the call interface small + decouples from the full record
 * shape so we can decide without threading id / timestamp / etc.
 * through every code path that just wants "may I talk to this
 * scheme://host:port?".
 */
export interface CheckInput {
	scheme: string
	host: string
	port: number
	source: string
}

/**
 * Restorm's own infrastructure ports on localhost. The renderer ↔
 * main GraphQL bridge, the Vite dev server in dev, and the MCP
 * server when launched with `--mcp` all live on `localhost:<port>`
 * with ports picked at boot time. Any traffic targeting these
 * gets auto-allowed regardless of the whitelist — they're internal
 * plumbing the user can't disable. A malicious package on
 * `localhost:1234` does NOT benefit from this exemption: the
 * scope is restricted to the exact ports `RestormInfraPorts`
 * holds at decision time.
 */
export interface RestormInfraPorts {
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
 * E2E test bypass — when restorm boots under Playwright with an
 * isolated user-data dir, the fixture sets `RESTORM_USER_DATA_OVERRIDE`
 * (see `tests/e2e/bdd/fixtures/*.fixture.ts`). Tests start mock
 * HTTP servers on ephemeral localhost ports that cannot be in any
 * whitelist (the port is allocated AFTER the user-data dir is set),
 * so without the bypass every test that imports a swagger from a
 * mock server would deadlock waiting on a toast that nobody can
 * click in headless mode. The bypass is observed once at module
 * load — flipping the env var at runtime won't re-arm the firewall.
 */
const E2E_BYPASS = ((): boolean => {
	const v = process.env['RESTORM_USER_DATA_OVERRIDE']
	return typeof v === 'string' && v.length > 0
})()

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
	 * Restorm's own infrastructure ports. Populated on app boot
	 * (graphql, vite-dev) and after MCP server start (mcp). The
	 * three are read at every check; if any becomes `null` the
	 * matching auto-allow is disabled.
	 */
	private infraPorts: RestormInfraPorts = { graphqlPort: null, mcpPort: null, viteDevPort: null }

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
		if (host.length === 0 || !Number.isFinite(port) || port < 0 || port > 65535) return null
		return { scheme, host, port }
	}

	private equals(a: FirewallOrigin, b: FirewallOrigin): boolean {
		return a.scheme === b.scheme && a.host === b.host && a.port === b.port
	}

	private contains(list: FirewallOrigin[], origin: FirewallOrigin): boolean {
		for (const entry of list) if (this.equals(entry, origin)) return true
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
	 * Update the restorm-internal port set. Called once per port at
	 * app boot (graphql, vite-dev) and once when the MCP server
	 * starts (mcp). Setting any field to `null` disables the
	 * corresponding auto-allow.
	 */
	setInfraPorts(patch: Partial<RestormInfraPorts>): void {
		this.infraPorts = { ...this.infraPorts, ...patch }
	}

	getInfraPorts(): RestormInfraPorts {
		return { ...this.infraPorts }
	}

	/**
	 * True if the origin is `localhost:<port>` and `<port>` matches
	 * one of restorm's known infrastructure ports. Localhost on any
	 * other port is NOT auto-allowed — this is the explicit narrow
	 * exception the user asked for.
	 */
	private isInfraOrigin(origin: FirewallOrigin): boolean {
		if (!LOCALHOST_HOSTS.has(origin.host)) return false
		const { graphqlPort, mcpPort, viteDevPort } = this.infraPorts
		return origin.port === graphqlPort || origin.port === mcpPort || origin.port === viteDevPort
	}

	check(input: CheckInput): Promise<Verdict> {
		if (E2E_BYPASS) return Promise.resolve('allow')
		this.loadIfNeeded()
		const origin: FirewallOrigin = {
			scheme: input.scheme.toLowerCase(),
			host: input.host.toLowerCase(),
			port: input.port
		}
		// Defensive: empty-host URLs (data:, blob:, …) should never
		// reach here (Layer A filters them upstream), but if they do
		// we let them through.
		if (origin.host === '') return Promise.resolve('allow')
		// Restorm's own infrastructure ports: graphql bridge, vite-dev,
		// mcp. Auto-allow without prompt or audit-side noise.
		if (this.isInfraOrigin(origin)) return Promise.resolve('allow')
		// Whitelist hit OR project-derived hit → allow silently.
		if (this.contains(this.whitelist, origin)) return Promise.resolve('allow')
		if (this.contains(this.projectOrigins, origin)) return Promise.resolve('allow')
		// Blacklist hit → deny without prompting (the user already
		// explicitly denied this origin).
		if (this.contains(this.blacklist, origin)) {
			logger.warn('PermissionService: denied (blacklist)', { origin, source: input.source })
			return Promise.resolve('deny')
		}
		// Unknown destination → toast prompt.
		return this.requestPrompt(origin, input.source)
	}

	/**
	 * Synchronous variant for Layer B (main-process http/https/fetch
	 * monkey-patches) which can't suspend the call's return. Mirrors
	 * the same gates as `check()`, but the toast-prompt branch
	 * collapses to `allow` — sync callers can't await the async
	 * resolution. The async path on Layer A is the canonical block;
	 * Layer B's contribution to the security model is the blacklist
	 * + project-origins gates (which are still effective here).
	 */
	checkSync(input: CheckInput): Verdict {
		if (E2E_BYPASS) return 'allow'
		this.loadIfNeeded()
		const origin: FirewallOrigin = {
			scheme: input.scheme.toLowerCase(),
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
		return 'allow'
	}

	private originKey(origin: FirewallOrigin): string {
		return `${origin.scheme}://${origin.host}:${String(origin.port)}`
	}

	private requestPrompt(origin: FirewallOrigin, source: string): Promise<Verdict> {
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
				logger.warn('PermissionService: prompt timed out (auto-deny)', { promptId, origin, source, timeoutMs: PROMPT_TIMEOUT_MS })
				this.resolvePrompt(promptId, 'deny')
			}, PROMPT_TIMEOUT_MS)
			timeoutHandle.unref()
			this.pendingPrompts.set(promptId, { resolve, origin, timeoutHandle })
		})
		this.promptByOrigin.set(key, promptId)
		const payload: FirewallPromptPayload = {
			promptId,
			origin,
			source: source as FirewallPromptPayload['source'],
			timestamp: new Date().toISOString()
		}
		const targets = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
		if (targets.length === 0) {
			logger.warn('PermissionService: no renderer window for prompt — auto-denying', { promptId, origin, source })
			queueMicrotask(() => { this.resolvePrompt(promptId, 'deny') })
			return promise
		}
		for (const win of targets) win.webContents.send(FIREWALL_IPC.PROMPT_SHOW, payload)
		return promise
	}

	resolvePrompt(promptId: string, verdict: Verdict): void {
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
		// Persist the user's decision into the matching list. Allow
		// → whitelist; deny → blacklist. Both lists' add* methods
		// dedupe + write through to disk.
		if (verdict === 'allow') this.addToWhitelist(pending.origin)
		else this.addToBlacklist(pending.origin)
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
	denyAllPending(): void {
		const ids = Array.from(this.pendingPrompts.keys())
		for (const promptId of ids) this.resolvePrompt(promptId, 'deny')
	}
}

function originOrder(a: FirewallOrigin, b: FirewallOrigin): number {
	if (a.host !== b.host) return a.host < b.host ? -1 : 1
	if (a.port !== b.port) return a.port - b.port
	return a.scheme < b.scheme ? -1 : a.scheme > b.scheme ? 1 : 0
}

export const permissionService = new PermissionService()
