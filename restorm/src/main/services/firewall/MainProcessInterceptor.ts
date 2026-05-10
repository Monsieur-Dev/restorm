import http, { type ClientRequest, type RequestOptions } from 'node:http'
import https from 'node:https'
import { randomUUID } from 'node:crypto'
import { logger, graphQLService } from 'electron-core-ui'
import { firewallService } from './FirewallService'
import { permissionService } from './PermissionService'
import { DeniedClientRequest } from './DeniedClientRequest'
import type {
	RequestRecord,
	RequestRecordProtocol,
	RequestRecordSource
} from '../../../shared/types/firewall'

/**
 * Layer B of the firewall. Every outgoing call from the main
 * process is captured, materialised into a `RequestRecord`,
 * routed through the synchronous PermissionService verdict, and
 * either:
 *
 *   - forwarded to the real `http.request` / `globalThis.fetch`
 *     (verdict `allow`), with the record emitted as `allow`, OR
 *   - replaced with a `DeniedClientRequest` stub (for http/https,
 *     emits `error` on next tick) / a rejected Promise (for
 *     fetch), with the record emitted as `deny` so the audit
 *     log + console show the block.
 *
 * Strict mode's async toast prompt is intentionally NOT awaited
 * here: `http.request()` is sync, so a real prompt-respecting
 * Layer B would need a `BufferingClientRequest` wrapper that
 * queues `req.write()` until the verdict resolves. That's
 * follow-up scope — until then `strict` is treated like
 * `log-only` from this layer's perspective (allow + audit). The
 * session-denylist gate still fires (so a user who picked "Deny
 * always" against a Layer A prompt also blocks main-process
 * traffic to the same destination).
 *
 * Patches `http.request`, `http.get`, `https.request`, `https.get`,
 * and `globalThis.fetch`. `dns.lookup` and `net.Socket.connect`
 * are deferred — every consumer we care about (axios, node-fetch,
 * undici, electron-vite, npm deps) goes through one of the patched
 * entrypoints before reaching DNS or raw sockets. If a future dep
 * bypasses all three we'll plug those then.
 *
 * Idempotent: a second install is a no-op so repeated bundler
 * reloads don't double-wrap.
 */

let installed = false

export function installMainProcessInterceptor(): void {
	if (installed) return
	installed = true

	patchHttpModule(http, 'main-http')
	patchHttpModule(https, 'main-https')
	patchFetch()

	logger.info('FirewallService: main-process interceptor installed (lockdown enforced)')
}

type HttpRequestFn = typeof http.request
type HttpGetFn = typeof http.get

interface HttpLikeModule {
	request: HttpRequestFn
	get: HttpGetFn
}

function patchHttpModule(mod: HttpLikeModule, source: RequestRecordSource): void {
	const originalRequest = mod.request.bind(mod)
	const originalGet = mod.get.bind(mod)

	const patchedRequest = ((...args: Parameters<HttpRequestFn>): ClientRequest => {
		const record = recordFromHttpArgs(args, source)
		if (record !== null) {
			const verdict = permissionService.checkSync({ host: record.host, port: record.port, source: record.source })
			record.verdict = verdict
			if (verdict === 'deny') {
				record.errorMessage = `firewall: denied (${permissionService.getMode()})`
				firewallService.emit(record)
				return makeDenied(record) as unknown as ClientRequest
			}
			firewallService.emit(record)
		}
		return originalRequest(...args)
	}) as HttpRequestFn

	const patchedGet = ((...args: Parameters<HttpGetFn>): ClientRequest => {
		const record = recordFromHttpArgs(args, source)
		if (record !== null) {
			const verdict = permissionService.checkSync({ host: record.host, port: record.port, source: record.source })
			record.verdict = verdict
			if (verdict === 'deny') {
				record.errorMessage = `firewall: denied (${permissionService.getMode()})`
				firewallService.emit(record)
				return makeDenied(record) as unknown as ClientRequest
			}
			firewallService.emit(record)
		}
		return originalGet(...args)
	}) as HttpGetFn

	mod.request = patchedRequest
	mod.get = patchedGet
}

function makeDenied(record: RequestRecord): DeniedClientRequest {
	return new DeniedClientRequest(`Firewall blocked outbound request to ${record.host}:${String(record.port)}`)
}

/**
 * Best-effort serialisation of `http.request` / `http.get` argument
 * variants into a `RequestRecord`. The signatures we have to handle:
 *
 * - `request(url)` / `request(url, options)` / `request(url, callback)`
 * - `request(url, options, callback)`
 * - `request(options)` / `request(options, callback)`
 *
 * `url` may be a string OR a `URL` instance. `options` carries
 * `host` / `hostname` / `port` / `method` / `path` / `headers` if
 * the caller passed them; we merge with whatever the URL parsed.
 *
 * Returns `null` if we can't piece together enough info — better to
 * miss a record than emit garbage.
 */
function recordFromHttpArgs(args: unknown[], source: RequestRecordSource): RequestRecord | null {
	let url: URL | null = null
	let options: RequestOptions = {}

	for (const arg of args) {
		if (typeof arg === 'string') {
			try { url = new URL(arg) } catch { /* malformed url — skip */ }
		} else if (arg instanceof URL) {
			url = arg
		} else if (typeof arg === 'object' && arg !== null && !isFunction(arg)) {
			options = { ...options, ...(arg as RequestOptions) }
		}
	}

	const rawHost = options.hostname ?? options.host ?? url?.hostname ?? ''
	const host = rawHost.toLowerCase()
	if (host === '') return null

	const protocol = source === 'main-https' ? 'https' : 'http'
	const portValue = options.port ?? url?.port
	const port = portValue !== undefined && portValue !== ''
		? Number(portValue)
		: (protocol === 'https' ? 443 : 80)

	const method = (options.method ?? 'GET').toUpperCase()
	const pathFromOpts = typeof options.path === 'string' ? options.path : null
	const fullUrl = url
		? url.toString()
		: `${protocol}://${host}${port !== (protocol === 'https' ? 443 : 80) ? `:${String(port)}` : ''}${pathFromOpts ?? '/'}`

	const headers: Record<string, string> = {}
	if (options.headers) {
		for (const [k, v] of Object.entries(options.headers)) {
			if (v === undefined) continue
			headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v)
		}
	}

	if (isInternalGraphqlEndpoint(fullUrl)) return null

	return {
		id: randomUUID(),
		timestamp: new Date().toISOString(),
		source,
		protocol,
		method,
		url: fullUrl,
		host,
		port: Number.isFinite(port) ? port : 0,
		headers,
		// `http.request`'s body is written via `req.write()` AFTER
		// the call returns — we don't see it here. A future
		// `BufferingClientRequest` wrapper would hook those writes
		// so the body lands on the record before the actual flush;
		// for now Layer B records always show empty bodies for POSTs.
		verdict: 'allow'
	}
}

/**
 * Skip records whose destination is the in-process GraphQL bridge
 * (`http://localhost:<port>/graphql`). Mirror of the same filter
 * in `FirewallService` (Layer A) — the renderer ↔ main IPC traffic
 * would drown the audit feed otherwise.
 */
function isInternalGraphqlEndpoint(rawUrl: string): boolean {
	try {
		const requested = new URL(rawUrl)
		const internal = new URL(graphQLService.getEndpoint())
		if (requested.host !== internal.host) return false
		return requested.pathname === internal.pathname || requested.pathname.startsWith(`${internal.pathname}/`)
	} catch {
		return false
	}
}

function isFunction(v: unknown): boolean {
	return typeof v === 'function'
}

function patchFetch(): void {
	const originalFetch = globalThis.fetch
	if (typeof originalFetch !== 'function') return

	const patched: typeof fetch = async (input, init) => {
		let record: RequestRecord | null = null
		try {
			record = recordFromFetchArgs(input, init)
		} catch (err) {
			logger.warn('FirewallService: failed to build fetch record', { error: String(err) })
		}
		if (record !== null) {
			const verdict = permissionService.checkSync({ host: record.host, port: record.port, source: record.source })
			record.verdict = verdict
			if (verdict === 'deny') {
				record.errorMessage = `firewall: denied (${permissionService.getMode()})`
				firewallService.emit(record)
				const err = new Error(`Firewall blocked outbound fetch to ${record.host}:${String(record.port)}`)
				;(err as Error & { code?: string }).code = 'EFIREWALLDENIED'
				throw err
			}
			firewallService.emit(record)
		}
		return originalFetch(input, init)
	}

	globalThis.fetch = patched
}

function recordFromFetchArgs(input: RequestInfo | URL, init: RequestInit | undefined): RequestRecord | null {
	let raw: string
	let method: string | undefined
	let headers: Record<string, string> = {}
	let body: string | undefined

	if (typeof input === 'string') {
		raw = input
	} else if (input instanceof URL) {
		raw = input.toString()
	} else {
		// `Request` instance — pull URL + method + headers from it.
		raw = input.url
		method = input.method
		input.headers.forEach((v, k) => { headers[k.toLowerCase()] = v })
	}

	if (init !== undefined) {
		if (init.method !== undefined) method = init.method
		if (init.headers !== undefined) {
			const h = init.headers
			if (h instanceof Headers) {
				h.forEach((v, k) => { headers[k.toLowerCase()] = v })
			} else if (Array.isArray(h)) {
				for (const [k, v] of h) headers[k.toLowerCase()] = v
			} else {
				headers = { ...headers, ...lowerKeys(h) }
			}
		}
		if (typeof init.body === 'string') body = init.body
	}

	let parsed: URL | null = null
	try { parsed = new URL(raw) } catch { return null }
	if (isInternalGraphqlEndpoint(raw)) return null
	const host = parsed.hostname.toLowerCase()
	const protocol: RequestRecordProtocol = parsed.protocol === 'https:' ? 'https' : 'http'
	const port = parsed.port !== '' ? Number(parsed.port) : (protocol === 'https' ? 443 : 80)

	return {
		id: randomUUID(),
		timestamp: new Date().toISOString(),
		source: 'main-fetch',
		protocol,
		method: (method ?? 'GET').toUpperCase(),
		url: raw,
		host,
		port,
		headers,
		...(body !== undefined ? { body } : {}),
		verdict: 'allow'
	}
}

function lowerKeys(input: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = {}
	for (const [k, v] of Object.entries(input)) out[k.toLowerCase()] = v
	return out
}
