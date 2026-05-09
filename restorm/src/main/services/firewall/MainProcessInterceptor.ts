import http, { type ClientRequest, type RequestOptions } from 'node:http'
import https from 'node:https'
import { randomUUID } from 'node:crypto'
import { logger } from 'electron-core-ui'
import { firewallService } from './FirewallService'
import { permissionService } from './PermissionService'
import type {
	RequestRecord,
	RequestRecordProtocol,
	RequestRecordSource
} from '../../../shared/types/firewall'

/**
 * Layer B of OYO-276 firewall. Phase 3 is observability-only — every
 * outgoing call from the main process is captured, materialised into
 * a `RequestRecord`, broadcast to the console feed via
 * `FirewallService.emit`, and then forwarded UNCHANGED to the
 * underlying Node implementation. Phase 4 will add the
 * `PermissionService.check` gate + the `BufferingClientRequest`
 * wrapper that holds writes until the verdict resolves.
 *
 * Patches `http.request`, `http.get`, `https.request`, `https.get`,
 * and `globalThis.fetch`. `dns.lookup` and `net.Socket.connect` are
 * deferred — they're caught transitively because every consumer
 * we care about (axios, node-fetch, undici, electron-vite, npm
 * deps) goes through `http.request` / `https.request` / `fetch`
 * before it ever touches DNS or raw sockets. If a future dep
 * bypasses both we'll plug those then.
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

	logger.info('FirewallService: main-process interceptor installed (observability only)')
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
		if (record !== null) safeEmit(record)
		return originalRequest(...args)
	}) as HttpRequestFn

	const patchedGet = ((...args: Parameters<HttpGetFn>): ClientRequest => {
		const record = recordFromHttpArgs(args, source)
		if (record !== null) safeEmit(record)
		return originalGet(...args)
	}) as HttpGetFn

	mod.request = patchedRequest
	mod.get = patchedGet
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
		// `http.request`'s body is written via `req.write` AFTER the
		// call returns — we don't see it here. Phase 4's
		// BufferingClientRequest wrapper will hook those writes so
		// the body lands on the record before the actual flush.
		verdict: 'allow'
	}
}

function isFunction(v: unknown): boolean {
	return typeof v === 'function'
}

function patchFetch(): void {
	const originalFetch = globalThis.fetch
	if (typeof originalFetch !== 'function') return

	const patched: typeof fetch = async (input, init) => {
		try {
			const record = recordFromFetchArgs(input, init)
			if (record !== null) safeEmit(record)
		} catch (err) {
			logger.warn('FirewallService: failed to emit fetch record', { error: String(err) })
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

function safeEmit(record: RequestRecord): void {
	// Resolve the verdict eagerly via the PermissionService, then
	// emit. Phase 4A's check is sync-allow for everything except
	// `lockdown` mode, so this doesn't add latency to the request
	// path; Phase 4C's toast prompt will introduce a `pending`
	// state + a follow-up emit once the user resolves.
	permissionService
		.check({ host: record.host, port: record.port, source: record.source })
		.then((verdict) => {
			record.verdict = verdict
			firewallService.emit(record)
		})
		.catch((err: unknown) => {
			logger.warn('FirewallService: permission check failed', { url: record.url, error: String(err) })
			firewallService.emit(record)
		})
}
