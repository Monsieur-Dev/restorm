import { BrowserWindow, session, type OnBeforeRequestListenerDetails } from 'electron'
import { randomUUID } from 'node:crypto'
import { logger, graphQLService } from 'electron-core-ui'
import {
	FIREWALL_REQUEST_RECORD_CHANNEL,
	type RequestRecord,
	type RequestRecordProtocol
} from '../../../shared/types/firewall'
import { permissionService } from './PermissionService'
import { detectWireProtocol } from './protocolDetect'

/**
 * `FirewallService` — Layer A (renderer / Chromium webRequest).
 *
 * Installs Chromium's `session.defaultSession.webRequest.onBeforeRequest`
 * listener at app boot. Every outbound call from a renderer context
 * (fetch / XHR / WebSocket upgrade / subresource load) is captured,
 * routed through `PermissionService.check`, materialised into a
 * `RequestRecord`, and either broadcast as `allow` + forwarded, or
 * broadcast as `deny` + cancelled via `callback({ cancel: true })`.
 *
 * Layer B (monkey-patched `http.request` / `https.request` /
 * `globalThis.fetch` in the main process) lives in
 * `MainProcessInterceptor.ts`. Both layers `emit()` records through
 * this service so the console feed stays single-sourced.
 *
 * Records are broadcast unicast-style: every webContents subscribed
 * to the channel receives the same payload. The console workbench
 * tab in the renderer is the primary consumer; the statusbar
 * indicator subscribes in parallel for the deny pulse + counter.
 */
class FirewallService {
	private listenerInstalled = false

	/**
	 * Wire `session.defaultSession.webRequest.onBeforeRequest` to
	 * the record emitter. Idempotent — calling it twice is a no-op
	 * (Electron only supports one `onBeforeRequest` listener per
	 * session, so a second registration would silently override
	 * the first; this guard keeps the contract obvious).
	 */
	registerWebRequestListener(): void {
		if (this.listenerInstalled) return
		this.listenerInstalled = true

		session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
			// Skip non-network URLs: chrome-extension://, devtools://,
			// data:, blob:, file:, ws-related dev-tools traffic. These
			// have no real "destination host" and shouldn't trip the
			// firewall — gating them on a verdict promise would freeze
			// devtools / loaded extensions / inline data URIs until the
			// user clicks a prompt that doesn't even make sense for
			// them.
			if (!isNetworkScheme(details.url)) {
				callback({ cancel: false })
				return
			}
			// Skip the in-process GraphQL bridge — every renderer ↔
			// main IPC call rides over `http://localhost:<port>/graphql`,
			// so the audit feed would be drowned in chatter the user
			// can't act on. Pass the request through unchanged
			// (allow-and-forget; not even broadcast as a record).
			if (isInternalGraphqlEndpoint(details.url)) {
				callback({ cancel: false })
				return
			}
			// Skip the Vite dev-server origin — in dev mode the
			// renderer + every imported module + every static asset
			// (HMR pings, source maps, on-demand chunks, public
			// images) ride `http://localhost:5173/...`. Production
			// builds load from `app://` / `file://` so the filter
			// is a no-op there. The origin comes from
			// `ELECTRON_RENDERER_URL` which electron-vite sets at
			// dev boot.
			if (isViteDevOrigin(details.url)) {
				callback({ cancel: false })
				return
			}
			// Skip requests originating from the Mini browser's
			// `<iframe>` — the firewall is meant to gate restorm's
			// own outbound calls (HTTP / GraphQL / WebSocket
			// executions, auth prefetch, import fetches), not
			// arbitrary third-party browsing inside the embedded
			// iframe. Without this bypass the user would have to
			// click "Allow" for every CSS / font / XHR an embedded
			// page makes — dozens of prompts per page load.
			//
			// Heuristic: the request's owning frame is a non-main
			// frame whose document URL is an external `http(s)://`
			// origin (i.e. not the renderer's own Vite / app
			// origin). Internal iframes used by Monaco / devtools
			// load via `vscode-resource:` / `devtools://` and don't
			// match. The top-level renderer document is always the
			// main frame, so it short-circuits cleanly here too.
			if (isMiniBrowserIframeRequest(details)) {
				callback({ cancel: false })
				return
			}
			let record: RequestRecord | null = null
			try {
				record = this.recordFromWebRequest(details)
			} catch (err) {
				logger.warn('FirewallService: failed to build RequestRecord', {
					url: details.url,
					error: String(err)
				})
			}
			if (record === null) {
				callback({ cancel: false })
				return
			}
			// Route through PermissionService. Three resolutions:
			//   - immediate `allow` (whitelist hit, project-origins
			//     hit, or restorm infra port);
			//   - immediate `deny` (blacklist hit);
			//   - async `allow` / `deny` after the user clicks one
			//     of the two toast buttons (Allow → adds to
			//     whitelist + lets through; Deny → adds to
			//     blacklist + cancels).
			// Chromium holds the request until the callback fires,
			// which is what gives us a real block rather than a
			// "we logged it, then served it" race.
			const built = record
			const scheme = parseScheme(details.url)
			void permissionService
				.check({
					scheme,
					host: built.host,
					port: built.port,
					source: built.source,
					...(built.originHint !== undefined ? { originHint: built.originHint } : {})
				})
				.then((verdict) => {
					built.verdict = verdict
					this.broadcast(built)
					callback({ cancel: verdict === 'deny' })
				})
				.catch((err: unknown) => {
					logger.warn('FirewallService: permission check failed', {
						url: details.url,
						error: String(err)
					})
					this.broadcast(built)
					callback({ cancel: false })
				})
		})

		logger.info('FirewallService: webRequest listener installed')
	}

	/**
	 * Build a `RequestRecord` from Electron's `OnBeforeRequestListenerDetails`.
	 * The Chromium hook only exposes the URL + method + uploadData
	 * — request headers would need a parallel `onSendHeaders` pass.
	 * For now the `headers` map stays empty on Layer A records; the
	 * console renders them as `(no headers captured)`.
	 */
	private recordFromWebRequest(details: OnBeforeRequestListenerDetails): RequestRecord {
		const parsed = safeParseUrl(details.url)
		const protocol = inferProtocol(parsed)
		const port = parsed?.port ? Number(parsed.port) : defaultPortForProtocol(protocol)
		const host = parsed?.hostname.toLowerCase() ?? ''
		// Chromium's `uploadData` is an array of `UploadData` chunks
		// (each carrying either a `bytes` Buffer or a `file` path).
		// For the console feed we collapse the bytes into a single
		// utf-8 string when the chunk is small enough; otherwise we
		// flag the body as `<binary 1234 bytes>` so the renderer
		// doesn't try to print megabytes of garbage.
		const body = uploadDataToString(details.uploadData)
		// Layer A doesn't see request headers (`onBeforeRequest` fires
		// before `onSendHeaders`), so the protocol detector can only
		// rely on URL patterns + body shape here. Layer B's headers-
		// rich path catches the remainder.
		const refinedProtocol = detectWireProtocol({ url: details.url, headers: {}, body, baseProtocol: protocol })
		return {
			id: randomUUID(),
			timestamp: new Date().toISOString(),
			source: 'renderer-webrequest',
			protocol: refinedProtocol,
			method: details.method.toUpperCase(),
			url: details.url,
			host,
			port,
			headers: {},
			...(body !== undefined ? { body } : {}),
			verdict: 'allow',
			...(details.frame?.url !== undefined ? { originHint: `frame: ${details.frame.url}` } : {})
		}
	}

	/**
	 * Public hook for emitters that aren't the webRequest listener
	 * — Layer B's monkey-patched `http.request` / `https.request` /
	 * `globalThis.fetch` build their own `RequestRecord` and call
	 * this to push it through the same broadcast pipeline. Single
	 * fan-out keeps the console / audit log feeds in sync.
	 */
	emit(record: RequestRecord): void {
		this.broadcast(record)
	}

	/**
	 * Send a record to every live BrowserWindow's renderer. The
	 * console UI listens via the preload bridge (`window.api.firewall.onRecord`).
	 */
	private broadcast(record: RequestRecord): void {
		for (const win of BrowserWindow.getAllWindows()) {
			if (win.isDestroyed()) continue
			win.webContents.send(FIREWALL_REQUEST_RECORD_CHANNEL, record)
		}
	}
}

function safeParseUrl(raw: string): URL | null {
	try { return new URL(raw) } catch { return null }
}

function parseScheme(rawUrl: string): string {
	try {
		return new URL(rawUrl).protocol.replace(/:$/, '').toLowerCase()
	} catch {
		return 'http'
	}
}

const NETWORK_SCHEMES = new Set<string>(['http:', 'https:', 'ws:', 'wss:'])
function isNetworkScheme(rawUrl: string): boolean {
	try {
		const u = new URL(rawUrl)
		return NETWORK_SCHEMES.has(u.protocol.toLowerCase())
	} catch {
		return false
	}
}

/**
 * True for the in-process GraphQL bridge endpoint. Compares against
 * the live `graphQLService.getEndpoint()` so a port change between
 * boots (free-port lottery) is picked up automatically. Only matches
 * the `/graphql` path (and trailing variants like `/graphql/something`)
 * so a future user-defined GraphQL request hosted on the same port
 * wouldn't be silently swallowed.
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

/**
 * True for any URL whose origin matches the electron-vite dev-server.
 * `ELECTRON_RENDERER_URL` is set by electron-vite at dev boot
 * (`http://localhost:5173`). In production builds it's undefined, so
 * the predicate is a no-op and nothing gets filtered. We compare
 * origin (scheme+host+port) rather than substring so a real user
 * request to `localhost:5173/api/...` from inside a request tab
 * (unlikely but possible) would still be captured — only assets +
 * HMR traffic served at the dev origin are skipped.
 */
const VITE_DEV_ORIGIN = (() => {
	const raw = process.env['ELECTRON_RENDERER_URL']
	if (typeof raw !== 'string' || raw === '') return null
	try { return new URL(raw).origin } catch { return null }
})()
function isViteDevOrigin(rawUrl: string): boolean {
	if (VITE_DEV_ORIGIN === null) return false
	try { return new URL(rawUrl).origin === VITE_DEV_ORIGIN } catch { return false }
}

/**
 * Detect requests that originated from the Mini browser's `<iframe>`
 * (rendering arbitrary third-party content like the artifactsmmo
 * game UI). The firewall stays out of those — the user opened the
 * Mini browser explicitly, prompting for every CSS/font/XHR the
 * embedded page makes would be unworkable.
 *
 * Conditions, all required:
 *   1. The request belongs to a frame Chromium can identify
 *      (`details.frame` populated — null for some service-worker
 *      paths, which we leave to the rest of the filter chain).
 *   2. That frame is NOT the top-level renderer — i.e. it's a
 *      subframe. The Mini browser renders the third-party page
 *      inside an `<iframe>`, so the frame chain is
 *      `top (restorm) → iframe (third-party)`. Requests whose
 *      `frame === frame.top` are restorm's own renderer making the
 *      call and stay under firewall control.
 *   3. The subframe's document URL is an external `http(s)://`
 *      origin. Internal Chromium iframes used by Monaco / devtools
 *      load via `vscode-resource:` / `devtools://` / `chrome-extension://`
 *      and don't match. The Vite dev origin is excluded so a
 *      hypothetical dev-mode iframe pointing at `localhost:5173`
 *      wouldn't accidentally bypass the firewall.
 */
function isMiniBrowserIframeRequest(details: OnBeforeRequestListenerDetails): boolean {
	// (1) Iframe navigation itself — the request that fetches the
	//     iframe's main HTML document. At this point `details.frame`
	//     still points at the parent (top) frame because the iframe
	//     document doesn't exist yet, so the frame-based check below
	//     would miss this navigation. Detect it via
	//     `resourceType === 'subFrame'` and confirm the destination
	//     is an external http(s) origin (the Mini browser is the only
	//     surface in restorm that points an iframe at one).
	if (details.resourceType === 'subFrame' && isExternalHttpUrl(details.url)) {
		return true
	}
	// (2) Sub-resource of an already-loaded iframe (CSS, JS, font,
	//     XHR, fetch, …). `details.frame` is the iframe's frame, not
	//     the top one. `frame === frame.top` ⇒ main frame (restorm
	//     itself); any other frame is a subframe.
	const frame = details.frame
	if (!frame) return false
	if (frame === frame.top) return false
	const frameUrl = frame.url
	if (typeof frameUrl !== 'string' || frameUrl === '') return false
	return isExternalHttpUrl(frameUrl)
}

/**
 * `true` iff the URL parses as http(s) AND its origin is NOT the
 * Vite dev origin. Used to distinguish a third-party page (which the
 * Mini browser is meant to load) from restorm's own renderer / dev
 * assets / internal `vscode-resource:` / `devtools://` URLs.
 */
function isExternalHttpUrl(rawUrl: string): boolean {
	let parsed: URL
	try { parsed = new URL(rawUrl) } catch { return false }
	const scheme = parsed.protocol.replace(/:$/, '').toLowerCase()
	if (scheme !== 'http' && scheme !== 'https') return false
	if (VITE_DEV_ORIGIN !== null && parsed.origin === VITE_DEV_ORIGIN) return false
	return true
}

function inferProtocol(parsed: URL | null): RequestRecordProtocol {
	if (!parsed) return 'http'
	const scheme = parsed.protocol.replace(/:$/, '').toLowerCase()
	if (scheme === 'wss' || scheme === 'ws') return 'websocket'
	if (scheme === 'https') return 'https'
	return 'http'
}

function defaultPortForProtocol(p: RequestRecordProtocol): number {
	if (p === 'https') return 443
	if (p === 'websocket') return 443
	return 80
}

/**
 * Best-effort: collapse small upload chunks into a utf-8 string for
 * console rendering, fall back to a placeholder for anything large
 * or binary-looking. Size threshold is conservative — the console
 * inlines the bytes so we don't want a 5 MB body to land in xterm.js.
 */
const BODY_INLINE_LIMIT_BYTES = 64 * 1024
function uploadDataToString(uploadData: OnBeforeRequestListenerDetails['uploadData']): string | undefined {
	// Electron's TS type narrows `uploadData` to non-undefined, but
	// at runtime it's frequently absent for GET / HEAD / cached
	// subresource requests — Chromium only attaches it when the
	// caller actually has body chunks to send. Guard explicitly via
	// an `unknown` cast so the emit doesn't crash on every read-only
	// request without lying to TS about the runtime type.
	const data = uploadData as unknown as { length?: number } | null | undefined
	if (!data?.length) return undefined
	const buffers: Buffer[] = []
	for (const chunk of uploadData) {
		const bytes = (chunk as { bytes?: Buffer }).bytes
		const file = (chunk as { file?: string }).file
		if (bytes !== undefined) buffers.push(bytes)
		else if (file !== undefined) return `<file ${file}>`
	}
	if (buffers.length === 0) return undefined
	const merged = Buffer.concat(buffers)
	if (merged.byteLength > BODY_INLINE_LIMIT_BYTES) {
		return `<binary ${String(merged.byteLength)} bytes>`
	}
	return merged.toString('utf8')
}

export const firewallService = new FirewallService()
