import { app, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { logger } from 'electron-core-ui'
import { FIREWALL_IPC, type FirewallMode, type FirewallPromptPayload } from '../../../shared/types/firewall'

/**
 * Firewall mode — re-exported from shared so existing local imports
 * (`./PermissionService`) keep resolving. The canonical declaration
 * lives in `shared/types/firewall.ts` so the renderer settings UI
 * can name the same union without reaching into main.
 *
 * Behaviour:
 * - `strict`: unknown destination → broadcast a toast-prompt IPC
 *   (one toast per host:port; subsequent in-flight calls to the
 *   same destination join the same waiter list). Resolves to
 *   `allow` / `deny` when the user clicks one of the four buttons.
 * - `log-only`: unknown destination → resolve immediately to
 *   `allow`, but the audit log keeps the entry. Default mode —
 *   `strict` requires explicit opt-in via the statusbar indicator
 *   because defaulting to it would deadlock headless boots (e2e,
 *   CI) on the first non-localhost asset load.
 * - `lockdown`: unknown destination → resolve immediately to
 *   `deny`, no prompt. The "I'm running an untrusted plugin and
 *   nothing else should be able to phone home" mode.
 */
export type { FirewallMode }

/**
 * Verdict the `PermissionService` returns. Strict mode + unknown
 * destination is the only path that can take longer than a
 * microtask — the returned promise stays unresolved until the
 * renderer dispatches `firewall:prompt-resolve`.
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
 * verdicts. Owns the in-memory mode + allowlist + session denylist,
 * persists the first two to `userData/firewall/state.json`, and
 * dispatches the toast-prompt round-trip for strict mode.
 *
 * Stays in the main process. The renderer interacts via the IPC
 * bridge in `firewallIpc.ts` (`window.api.firewall.*` after the
 * preload binding).
 */
interface PersistedState {
	mode: FirewallMode
	allowlist: string[]
}

interface PendingPrompt {
	resolve: (verdict: Verdict) => void
	host: string
	port: number
	timeoutHandle: NodeJS.Timeout
}

/**
 * Auto-deny age for unanswered prompts. Without this, any pending
 * prompt holds Layer A's `onBeforeRequest` callback open forever,
 * which Chromium translates to "the request hangs." A user who
 * opens a request with the toaster collapsed never sees the toast
 * and the page just spins. 60 seconds is enough for the user to
 * look at the prompt + decide; if they don't, falling back to
 * `deny` matches the conservative-default principle.
 */
const PROMPT_TIMEOUT_MS = 60_000

class PermissionService {
	// Default mode is `log-only`: every outbound call lands in the
	// audit feed but nothing is blocked or prompted. `strict` is
	// opt-in via the Settings panel — auto-enabling it would freeze
	// any renderer that talks to a non-localhost host (subresource
	// loads, third-party scripts, font CDNs) until the user clicks
	// the toast. Because the toast resolves in the renderer, headless
	// boots (e2e tests, CI) would deadlock the renderer's first
	// outbound request. Lockdown stays an explicit opt-in too.
	private mode: FirewallMode = 'log-only'

	/**
	 * Pending toast prompts keyed by promptId. The renderer
	 * resolves each one via `resolvePrompt(promptId, verdict,
	 * persist)`. We dedupe in-flight prompts by `host:port` via
	 * `promptByHostPort` so a flurry of subresource loads to the
	 * same destination only triggers one toast — the verdict is
	 * fanned back out to every queued waiter on resolution.
	 */
	private readonly pendingPrompts = new Map<string, PendingPrompt>()
	private readonly promptByHostPort = new Map<string, string>()
	private readonly waitersByHostPort = new Map<string, ((v: Verdict) => void)[]>()

	/**
	 * Hosts the user has explicitly denied for the rest of the
	 * session ("Deny always" → here). Cleared on app restart by
	 * design — a persistent denylist would need a separate
	 * `state.json` slot + a settings UI to reverse a mistaken
	 * deny, which is follow-up scope.
	 */
	private readonly sessionDenylist = new Set<string>()

	/**
	 * In-memory allowlist of host patterns. Each entry is either
	 * a literal hostname (`api.example.com`) or a single-level
	 * wildcard (`*.example.com`, matches one DNS label). Persists
	 * to disk on every mutation via `persist()`; loaded once on
	 * `loadIfNeeded()` (called lazily on first access so the
	 * service can be imported before `app.whenReady()`).
	 */
	private readonly allowlist = new Set<string>()

	private loaded = false
	private statePath: string | null = null

	private resolvePath(): string {
		if (this.statePath !== null) return this.statePath
		// `app.getPath('userData')` is only safe to call after
		// `app.ready` — in dev with electron-vite the firewall
		// module loads BEFORE app-ready so we defer the path
		// resolution to first use. The lazy path also keeps the
		// service unit-testable: tests can stub `app` before any
		// method runs.
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
			const mode = parsed.mode
			if (mode === 'strict' || mode === 'log-only' || mode === 'lockdown') {
				this.mode = mode
			}
			if (Array.isArray(parsed.allowlist)) {
				this.allowlist.clear()
				for (const entry of parsed.allowlist) {
					if (typeof entry === 'string' && entry.length > 0) {
						this.allowlist.add(entry.toLowerCase())
					}
				}
			}
			logger.info('PermissionService: loaded persisted state', {
				mode: this.mode,
				allowlistSize: this.allowlist.size
			})
		} catch (err) {
			logger.warn('PermissionService: failed to load persisted state', {
				path,
				error: String(err)
			})
		}
	}

	private persist(): void {
		try {
			const path = this.resolvePath()
			mkdirSync(dirname(path), { recursive: true })
			const state: PersistedState = {
				mode: this.mode,
				allowlist: Array.from(this.allowlist).sort()
			}
			writeFileSync(path, JSON.stringify(state, null, 2), 'utf8')
		} catch (err) {
			logger.warn('PermissionService: failed to persist state', { error: String(err) })
		}
	}

	getMode(): FirewallMode {
		this.loadIfNeeded()
		return this.mode
	}

	setMode(mode: FirewallMode): void {
		this.loadIfNeeded()
		if (this.mode === mode) return
		this.mode = mode
		this.persist()
		logger.info('PermissionService: mode changed', { mode })
	}

	/**
	 * Add a host pattern to the allowlist. Pattern is the literal
	 * hostname or a single-level wildcard (`*.example.com`). The
	 * lookup is case-insensitive — entries are lower-cased on
	 * insert. Persists to disk on every successful insert.
	 */
	addToAllowlist(pattern: string): void {
		this.loadIfNeeded()
		const normalised = pattern.toLowerCase().trim()
		if (normalised.length === 0) return
		if (this.allowlist.has(normalised)) return
		this.allowlist.add(normalised)
		this.persist()
	}

	removeFromAllowlist(pattern: string): void {
		this.loadIfNeeded()
		const normalised = pattern.toLowerCase().trim()
		if (this.allowlist.delete(normalised)) {
			this.persist()
		}
	}

	listAllowlist(): string[] {
		this.loadIfNeeded()
		return Array.from(this.allowlist).sort()
	}

	/**
	 * Verdict for a given destination. Order of checks:
	 *
	 * 1. Empty host (non-network URL) → `allow` (defensive; the
	 *    Layer A listener already filters non-network schemes).
	 * 2. Localhost aliases → `allow` (still emitted to the audit
	 *    log via the caller — just no firewall blocking).
	 * 3. Allowlist hit (literal or wildcard `*.example.com`) → `allow`.
	 * 4. Session denylist hit → `deny`.
	 * 5. Mode-driven default for unknown:
	 *    - `lockdown` → `deny`
	 *    - `log-only` → `allow` (audit only, no enforcement)
	 *    - `strict`   → broadcast a toast prompt and return its
	 *      Promise; resolves when the user clicks one of the four
	 *      buttons in the renderer.
	 */
	check(input: CheckInput): Promise<Verdict> {
		this.loadIfNeeded()
		const host = input.host.toLowerCase()
		// Defensive: empty host means the URL is non-network
		// (data:, blob:, chrome-extension:, …). The upstream layer
		// (FirewallService) already filters these, but we double-
		// check so the prompt path can't ever fire on a phantom
		// destination.
		if (host === '') return Promise.resolve('allow')
		if (LOCALHOST_HOSTS.has(host)) return Promise.resolve('allow')
		if (this.matchAllowlist(host)) return Promise.resolve('allow')
		const hostPortKey = `${host}:${String(input.port)}`
		if (this.sessionDenylist.has(hostPortKey)) return Promise.resolve('deny')
		switch (this.mode) {
			case 'lockdown':
				logger.warn('PermissionService: denied (lockdown)', { host, port: input.port, source: input.source })
				return Promise.resolve('deny')
			case 'strict':
				return this.requestPrompt(host, input.port, input.source)
			case 'log-only':
			default:
				return Promise.resolve('allow')
		}
	}

	/**
	 * Open a toast prompt for the given destination. Subsequent
	 * `check()` calls for the same `host:port` while the prompt is
	 * open are joined to the existing waiter list — the user's
	 * choice fans out to every queued resolver. Returns a promise
	 * that resolves once the renderer sends the resolution back via
	 * `resolvePrompt`.
	 */
	private requestPrompt(host: string, port: number, source: string): Promise<Verdict> {
		const hostPortKey = `${host}:${String(port)}`
		const existingPromptId = this.promptByHostPort.get(hostPortKey)
		if (existingPromptId !== undefined) {
			return new Promise<Verdict>((resolve) => {
				const queue = this.waitersByHostPort.get(hostPortKey) ?? []
				queue.push(resolve)
				this.waitersByHostPort.set(hostPortKey, queue)
			})
		}
		const promptId = randomUUID()
		const promise = new Promise<Verdict>((resolve) => {
			const timeoutHandle = setTimeout(() => {
				logger.warn('PermissionService: prompt timed out (auto-deny)', {
					promptId, host, port, source, timeoutMs: PROMPT_TIMEOUT_MS
				})
				this.resolvePrompt(promptId, 'deny', false)
			}, PROMPT_TIMEOUT_MS)
			// Don't keep the event loop alive just for an unanswered
			// firewall prompt — `unref()` lets `app.quit()` proceed
			// normally without a 60 s hang on shutdown.
			timeoutHandle.unref()
			this.pendingPrompts.set(promptId, { resolve, host, port, timeoutHandle })
		})
		this.promptByHostPort.set(hostPortKey, promptId)
		const payload: FirewallPromptPayload = {
			promptId,
			host,
			port,
			source: source as FirewallPromptPayload['source'],
			timestamp: new Date().toISOString()
		}
		const targets = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
		if (targets.length === 0) {
			// No window to show the toast in — auto-deny instead of
			// hanging Layer A forever. Headless boots and tail-of-life
			// shutdown ordering both hit this.
			logger.warn('PermissionService: no renderer window for prompt — auto-denying', {
				promptId, host, port, source
			})
			queueMicrotask(() => { this.resolvePrompt(promptId, 'deny', false) })
			return promise
		}
		for (const win of targets) {
			win.webContents.send(FIREWALL_IPC.PROMPT_SHOW, payload)
		}
		return promise
	}

	/**
	 * Auto-deny every outstanding prompt — wired to the
	 * `before-quit` lifecycle hook in main/index.ts so a shutdown
	 * mid-prompt doesn't leave the IPC bridge with dangling
	 * Promises that the renderer can never resolve. Idempotent.
	 */
	denyAllPending(): void {
		const ids = Array.from(this.pendingPrompts.keys())
		for (const promptId of ids) this.resolvePrompt(promptId, 'deny', false)
	}

	/**
	 * Resolve a pending prompt — invoked by the IPC handler when
	 * the renderer dispatches the user's choice. Fans the verdict
	 * out to every waiter joined to the same host:port.
	 *
	 * `persist: true` + `verdict: 'allow'` adds the host to the
	 * persistent allowlist (so subsequent calls don't re-prompt).
	 * `persist: true` + `verdict: 'deny'` adds it to the
	 * session-only denylist (a real persistent denylist would land
	 * in Phase 5).
	 */
	resolvePrompt(promptId: string, verdict: Verdict, persist: boolean): void {
		this.loadIfNeeded()
		const pending = this.pendingPrompts.get(promptId)
		if (pending === undefined) {
			// Already resolved — most often the auto-deny timeout
			// fired or a renderer click crossed paths with another
			// resolution. Silent: this is normal for a healthy
			// system, only worth a debug-level breadcrumb.
			logger.debug('PermissionService: resolvePrompt called for unknown id', { promptId })
			return
		}
		clearTimeout(pending.timeoutHandle)
		const hostPortKey = `${pending.host}:${String(pending.port)}`
		this.pendingPrompts.delete(promptId)
		this.promptByHostPort.delete(hostPortKey)
		if (persist) {
			if (verdict === 'allow') this.addToAllowlist(pending.host)
			else this.sessionDenylist.add(hostPortKey)
		}
		pending.resolve(verdict)
		const waiters = this.waitersByHostPort.get(hostPortKey)
		if (waiters !== undefined) {
			this.waitersByHostPort.delete(hostPortKey)
			for (const resolve of waiters) resolve(verdict)
		}
	}

	/**
	 * Synchronous variant — used by Layer B's main-process patches
	 * which can't suspend `http.request()`'s return value. Mirrors
	 * the same allowlist + session-denylist + lockdown gates as
	 * `check()`, with one omission by design: `strict` mode falls
	 * back to `allow` here because there's no way for a sync caller
	 * to await the toast prompt round-trip. A real toast-resolved
	 * deferral on Layer B would need a `BufferingClientRequest`
	 * wrapper that queues `req.write()` until the verdict resolves
	 * — that's follow-up scope.
	 */
	checkSync(input: CheckInput): Verdict {
		this.loadIfNeeded()
		const host = input.host.toLowerCase()
		if (host === '') return 'allow'
		if (LOCALHOST_HOSTS.has(host)) return 'allow'
		if (this.matchAllowlist(host)) return 'allow'
		// Honour the session denylist so a "Deny always" picked
		// against a Layer A prompt doesn't get bypassed when the
		// same host is next called from main-process http/fetch.
		const hostPortKey = `${host}:${String(input.port)}`
		if (this.sessionDenylist.has(hostPortKey)) {
			logger.warn('PermissionService: denied (session denylist)', { host, port: input.port, source: input.source })
			return 'deny'
		}
		switch (this.mode) {
			case 'lockdown':
				logger.warn('PermissionService: denied (lockdown)', { host, port: input.port, source: input.source })
				return 'deny'
			case 'log-only':
			case 'strict':
			default:
				return 'allow'
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
