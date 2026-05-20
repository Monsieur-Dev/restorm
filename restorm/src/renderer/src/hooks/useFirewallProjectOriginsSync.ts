import { useEffect, useMemo } from 'react'
import type { FolderItem, Request } from '../../../shared/types/collections'
import { isEnvironmentFolder, isAnyFolder, isScenario, isHTTPRequest, isGraphQLRequest, isSoapRequest, isWebSocketRequest, isODataRequest, isAuthenticationRequest, isGrpcRequest } from '../../../shared/types/collections'
import type { FirewallOrigin } from '../../../shared/types/firewall'

interface FirewallProjectApi {
	setProjectOrigins: (origins: FirewallOrigin[]) => Promise<void>
}

function getFirewallApi(): FirewallProjectApi | null {
	const api = (window as unknown as { api?: { firewall?: FirewallProjectApi } }).api?.firewall
	return api ?? null
}

/**
 * Walk the project tree, collect every request's URL, resolve
 * any `{{var}}` references against the available environments,
 * extract the `(scheme, host, port)` triple, and push the deduped
 * set to main via `window.api.firewall.setProjectOrigins`.
 *
 * The main-process `PermissionService` uses this set as one of
 * its three "known destination" sources — meaning a fresh
 * `run_request` against a project URL doesn't trigger a toast as
 * long as at least one environment resolves the URL to a valid
 * origin.
 *
 * Substitution is a simple `{{key}}` → value pass; full
 * Handlebars (helpers, partials, conditionals) isn't supported —
 * the firewall only needs origin metadata, not the full URL. If
 * the URL still has unresolved variables after substitution, we
 * skip it (can't infer an origin from a parametric host).
 */
export function useFirewallProjectOriginsSync(rootItems: FolderItem[]): void {
	const origins = useMemo<FirewallOrigin[]>(() => collectProjectOrigins(rootItems), [rootItems])
	useEffect(() => {
		const api = getFirewallApi()
		if (api === null) return
		void api.setProjectOrigins(origins)
	}, [origins])
}

function collectProjectOrigins(rootItems: FolderItem[]): FirewallOrigin[] {
	const requests = collectRequests(rootItems)
	const envContexts = collectEnvironmentContexts(rootItems)
	const seen = new Map<string, FirewallOrigin>()
	for (const request of requests) {
		const rawUrl = extractRawUrl(request)
		if (rawUrl === null) continue
		// If no env vars are referenced, evaluate once. Otherwise,
		// try every env context — a request might be a template
		// rendered into multiple hosts depending on the active env.
		const candidates = rawUrl.includes('{{') && envContexts.length > 0
			? envContexts.map((ctx) => substitute(rawUrl, ctx))
			: [rawUrl]
		// Add a no-substitution attempt too in case the URL is
		// fully literal (some users hardcode URLs).
		if (!candidates.includes(rawUrl)) candidates.push(rawUrl)
		for (const candidate of candidates) {
			const origin = parseOrigin(candidate)
			if (origin === null) continue
			const key = `${origin.scheme}://${origin.host}:${String(origin.port)}`
			if (!seen.has(key)) seen.set(key, origin)
		}
	}
	return Array.from(seen.values())
}

function collectRequests(items: FolderItem[]): Request[] {
	const out: Request[] = []
	const visit = (item: FolderItem): void => {
		if (isAnyFolder(item) || isEnvironmentFolder(item)) {
			for (const child of item.items) visit(child)
			return
		}
		if (isScenario(item)) return
		// All concrete request kinds carry a resolvable URL of some shape.
		if (isHTTPRequest(item) || isGraphQLRequest(item) || isSoapRequest(item) || isWebSocketRequest(item) || isODataRequest(item) || isAuthenticationRequest(item) || isGrpcRequest(item)) {
			out.push(item as Request)
		}
	}
	for (const item of items) visit(item)
	return out
}

type EnvContext = Record<string, string>

function collectEnvironmentContexts(items: FolderItem[]): EnvContext[] {
	const out: EnvContext[] = []
	const visit = (item: FolderItem): void => {
		if (isEnvironmentFolder(item)) {
			const folder = item
			const envs = Array.isArray(folder.environments) ? folder.environments : []
			for (const env of envs) {
				const ctx: EnvContext = {}
				const vars = Array.isArray(env.variables) ? env.variables : []
				for (const v of vars) {
					if (typeof v.key !== 'string') continue
					// `v.value` can arrive in three shapes depending on where
					// in the load pipeline we run:
					//   - `ValueType` class instance (StringValue, ExpressionValue,
					//     NumericValue, …) once the renderer's `makeReactive*`
					//     pass has reified the tree
					//   - plain POJO `{ type, value }` straight off the wire
					//     (file-open IPC, MCP `update_folder`, etc.) before
					//     reification fires
					//   - the raw string when an importer cut a corner
					// Extracting requires probing all three: the instance has
					// a meaningful `toString()`, the POJO needs `.value`
					// pulled out explicitly (its `.toString()` returns
					// `"[object Object]"`), and a raw string is itself.
					const str = extractValueString(v.value)
					if (str !== '') ctx[v.key] = str
				}
				out.push(ctx)
			}
			for (const child of item.items) visit(child)
			return
		}
		if (isAnyFolder(item)) {
			for (const child of item.items) visit(child)
		}
	}
	for (const item of items) visit(item)
	return out
}

/**
 * Coerce a `KeyValue.value` of unknown shape (live `ValueType` instance,
 * POJO `{ type, value }`, raw string, …) into the plain string the
 * firewall origin sync needs. Skipping any of these shapes makes the
 * env context drop the variable — and a missing `baseUrl` mapping
 * tanks every project-origin resolution that needs handlebars
 * substitution (which is most of them).
 */
function extractValueString(value: unknown): string {
	if (typeof value === 'string') return value
	if (value === null || value === undefined) return ''
	if (typeof value === 'object') {
		// POJO shape from the wire — `{ type: 'string', value: '...' }`.
		const inner = (value as { value?: unknown }).value
		if (typeof inner === 'string') return inner
		// Live `ValueType` instance — `.toString()` returns the stored
		// string. Skip if it falls through to `Object.prototype.toString`
		// (which yields the useless `"[object Object]"`).
		const toStr = (value as { toString?: () => string }).toString
		if (typeof toStr === 'function' && toStr !== Object.prototype.toString) {
			return toStr.call(value)
		}
	}
	return ''
}

function extractRawUrl(request: Request): string | null {
	const r = request as { url?: unknown; baseUrl?: unknown; endpoint?: unknown }
	for (const candidate of [r.url, r.baseUrl, r.endpoint]) {
		if (typeof candidate === 'string' && candidate.length > 0) return candidate
	}
	return null
}

function substitute(input: string, ctx: EnvContext): string {
	return input.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, key: string) => {
		const value = ctx[key]
		return typeof value === 'string' ? value : match
	})
}

function parseOrigin(rawUrl: string): FirewallOrigin | null {
	if (rawUrl.includes('{{')) return null  // unresolved variable, can't infer host
	let candidate = rawUrl.trim()
	if (candidate.length === 0) return null
	if (!candidate.includes('://')) candidate = `http://${candidate}`
	let parsed: URL
	try { parsed = new URL(candidate) } catch { return null }
	const scheme = parsed.protocol.replace(/:$/, '').toLowerCase()
	if (parsed.hostname.length === 0) return null
	const defaultPort = scheme === 'https' || scheme === 'wss' ? 443 : 80
	const port = parsed.port !== '' ? Number(parsed.port) : defaultPort
	if (!Number.isFinite(port) || port < 0 || port > 65535) return null
	return { scheme, host: parsed.hostname.toLowerCase(), port }
}
