import http, { type ClientRequest, type RequestOptions, type OutgoingHttpHeaders } from 'node:http'
import https from 'node:https'
import { randomUUID } from 'node:crypto'
import { logger, graphQLService } from 'electron-core-ui'
import { firewallService } from './FirewallService'
import { permissionService } from './PermissionService'
import { DeniedClientRequest } from './DeniedClientRequest'
import { BufferingClientRequest } from './BufferingClientRequest'
import { captureOriginHint } from './stackOrigin'
import { detectWireProtocol } from './protocolDetect'
import type {
	RequestRecord,
	RequestRecordProtocol,
	RequestRecordSource
} from '../../../shared/types/firewall'

/**
 * Layer B of the firewall. Every outgoing call from the main
 * process is captured, materialised into a `RequestRecord`, routed
 * through the firewall verdict, and either:
 *
 *   - forwarded to the real `http.request` / `globalThis.fetch` when
 *     `classify()` returns `allow` (with the record emitted as
 *     `allow`), OR
 *   - replaced with a `DeniedClientRequest` stub (for http/https) /
 *     a rejected Promise (for fetch) when `classify()` returns
 *     `deny`, with the record emitted as `deny` so the audit log
 *     + console show the block, OR
 *   - parked in a `BufferingClientRequest` (http/https) or awaited
 *     before delegating to the real `fetch` (fetch path) when
 *     `classify()` returns `prompt`. The toast resolves to
 *     `allow` → real request fires with replayed writes; `deny` →
 *     `EFIREWALLDENIED` surfaces to the caller.
 *
 * Patches `http.request`, `http.get`, `https.request`, `https.get`,
 * and `globalThis.fetch`. `dns.lookup` and `net.Socket.connect` are
 * deferred — every consumer we care about (axios, node-fetch, undici,
 * electron-vite, npm deps) goes through one of the patched
 * entrypoints before reaching DNS or raw sockets.
 *
 * Idempotent: a second install is a no-op so repeated bundler reloads
 * don't double-wrap.
 */

let installed = false

export function installMainProcessInterceptor(): void {
	if (installed) return
	installed = true

	patchHttpModule(http, 'main-http')
	patchHttpModule(https, 'main-https')
	patchFetch()

	logger.info('FirewallService: main-process interceptor installed')
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

	const dispatch = (
		args: unknown[],
		realFn: (a: unknown[]) => ClientRequest
	): ClientRequest => {
		const record = recordFromHttpArgs(args, source)
		if (record === null) return realFn(args)
		const originHint = captureOriginHint(2)
		if (originHint !== null) record.originHint = originHint
		const cls = permissionService.classify({
			scheme: record.protocol,
			host: record.host,
			port: record.port,
			source: record.source,
			...(originHint !== null ? { originHint } : {})
		})
		if (cls === 'deny') {
			record.verdict = 'deny'
			record.errorMessage = 'firewall: denied (blacklist)'
			firewallService.emit(record)
			return makeDenied(record) as unknown as ClientRequest
		}
		if (cls === 'allow') {
			record.verdict = 'allow'
			firewallService.emit(record)
			return realFn(args)
		}
		// `prompt` — buffer the request and start the async resolution.
		record.verdict = 'pending'
		firewallService.emit(record)
		const verdictPromise = permissionService.check({
			scheme: record.protocol,
			host: record.host,
			port: record.port,
			source: record.source,
			...(originHint !== null ? { originHint } : {})
		})
		const initialHeaders = extractHeadersFromArgs(args)
		const buffering = new BufferingClientRequest(
			args,
			verdictPromise.then((v) => {
				const completed: RequestRecord = { ...record, verdict: v }
				if (v === 'deny') completed.errorMessage = 'firewall: denied'
				firewallService.emit(completed)
				return v
			}),
			(merged) => realFn(merged),
			`Firewall blocked outbound request to ${record.host}:${String(record.port)}`,
			initialHeaders
		)
		return buffering as unknown as ClientRequest
	}

	const patchedRequest = ((...args: Parameters<HttpRequestFn>): ClientRequest => {
		return dispatch(args as unknown[], (a) => originalRequest(...(a as Parameters<HttpRequestFn>)))
	}) as HttpRequestFn

	const patchedGet = ((...args: Parameters<HttpGetFn>): ClientRequest => {
		return dispatch(args as unknown[], (a) => originalGet(...(a as Parameters<HttpGetFn>)))
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

	const refinedProtocol = detectWireProtocol({ url: fullUrl, headers, baseProtocol: protocol })
	return {
		id: randomUUID(),
		timestamp: new Date().toISOString(),
		source,
		protocol: refinedProtocol,
		method,
		url: fullUrl,
		host,
		port: Number.isFinite(port) ? port : 0,
		headers,
		// `http.request`'s body is written via `req.write()` AFTER the
		// call returns — Layer B records always show empty bodies for
		// streaming POSTs. The `BufferingClientRequest` *does* see
		// every write but doesn't re-emit a completion record (the
		// console renders the URL + method, not the body, for main-
		// side captures). Layer A captures bodies for renderer-side
		// fetch.
		verdict: 'allow'
	}
}

function extractHeadersFromArgs(args: unknown[]): OutgoingHttpHeaders | undefined {
	for (const arg of args) {
		if (typeof arg !== 'object' || arg === null || arg instanceof URL || isFunction(arg)) continue
		const opts = arg as { headers?: OutgoingHttpHeaders }
		if (opts.headers !== undefined) return opts.headers
	}
	return undefined
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
		if (record === null) return originalFetch(input, init)

		const originHint = captureOriginHint(2)
		if (originHint !== null) record.originHint = originHint
		const cls = permissionService.classify({
			scheme: record.protocol,
			host: record.host,
			port: record.port,
			source: record.source,
			...(originHint !== null ? { originHint } : {})
		})
		if (cls === 'deny') {
			record.verdict = 'deny'
			record.errorMessage = 'firewall: denied (blacklist)'
			firewallService.emit(record)
			throw makeFetchDenyError(record)
		}
		if (cls === 'allow') {
			record.verdict = 'allow'
			firewallService.emit(record)
			return originalFetch(input, init)
		}
		// `prompt` — emit `pending`, await the async verdict, then
		// finalise. The fetch path can suspend cleanly (it's async by
		// nature) so no buffering wrapper is needed; we just hold the
		// `originalFetch` call until the user picks.
		record.verdict = 'pending'
		firewallService.emit(record)
		const v = await permissionService.check({
			scheme: record.protocol,
			host: record.host,
			port: record.port,
			source: record.source,
			...(originHint !== null ? { originHint } : {})
		})
		const finalised: RequestRecord = { ...record, verdict: v }
		if (v === 'deny') {
			finalised.errorMessage = 'firewall: denied'
			firewallService.emit(finalised)
			throw makeFetchDenyError(record)
		}
		firewallService.emit(finalised)
		return originalFetch(input, init)
	}

	globalThis.fetch = patched
}

function makeFetchDenyError(record: RequestRecord): Error {
	const err = new Error(`Firewall blocked outbound fetch to ${record.host}:${String(record.port)}`)
	;(err as Error & { code?: string }).code = 'EFIREWALLDENIED'
	return err
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
	// Inline resources (`data:application/wasm;base64,...`,
	// `data:image/png;base64,...`) and other non-network schemes
	// (`blob:`, `file:`, `chrome-extension:`, `vscode-resource:`)
	// aren't real outbound traffic — they live inside the page. The
	// Chromium webRequest listener gates on `isNetworkScheme` for the
	// same reason; the fetch + http monkey-patches were missing the
	// symmetric gate, so a renderer fetching a data: URL surfaced as a
	// garbage `curl -X GET 'data:...'` record in the Console panel
	// (with the full base64 payload echoed back). Drop it cleanly.
	const lowerProtocol = parsed.protocol.toLowerCase()
	if (lowerProtocol !== 'http:' && lowerProtocol !== 'https:') return null
	if (isInternalGraphqlEndpoint(raw)) return null
	const host = parsed.hostname.toLowerCase()
	const protocol: RequestRecordProtocol = parsed.protocol === 'https:' ? 'https' : 'http'
	const port = parsed.port !== '' ? Number(parsed.port) : (protocol === 'https' ? 443 : 80)

	const refinedProtocol = detectWireProtocol({ url: raw, headers, body, baseProtocol: protocol })
	return {
		id: randomUUID(),
		timestamp: new Date().toISOString(),
		source: 'main-fetch',
		protocol: refinedProtocol,
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
