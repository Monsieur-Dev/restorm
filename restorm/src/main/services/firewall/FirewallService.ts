import { BrowserWindow, session, type OnBeforeRequestListenerDetails } from 'electron'
import { randomUUID } from 'node:crypto'
import { logger } from 'electron-core-ui'
import {
	FIREWALL_REQUEST_RECORD_CHANNEL,
	type RequestRecord,
	type RequestRecordProtocol
} from '../../../shared/types/firewall'
import { permissionService } from './PermissionService'

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
			// Route through PermissionService. The async `check()`
			// resolves immediately for `localhost` / allowlist hits
			// / `log-only` mode; resolves to `deny` for `lockdown`
			// mode; and resolves later (when the user clicks one of
			// the four toast buttons) for `strict` mode + unknown
			// destination. Chromium HOLDS the request until the
			// callback fires — this is what gives us a real block
			// rather than a "we logged it, then served it" race.
			const built = record
			void permissionService
				.check({ host: built.host, port: built.port, source: built.source })
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

		logger.info('FirewallService: webRequest listener installed (observability only)')
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
		return {
			id: randomUUID(),
			timestamp: new Date().toISOString(),
			source: 'renderer-webrequest',
			protocol,
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

const NETWORK_SCHEMES = new Set<string>(['http:', 'https:', 'ws:', 'wss:'])
function isNetworkScheme(rawUrl: string): boolean {
	try {
		const u = new URL(rawUrl)
		return NETWORK_SCHEMES.has(u.protocol.toLowerCase())
	} catch {
		return false
	}
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
