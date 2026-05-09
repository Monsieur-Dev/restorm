import { BrowserWindow, session, type OnBeforeRequestListenerDetails } from 'electron'
import { randomUUID } from 'node:crypto'
import { logger } from 'electron-core-ui'
import {
	FIREWALL_REQUEST_RECORD_CHANNEL,
	type RequestRecord,
	type RequestRecordProtocol
} from '../../../shared/types/firewall'

/**
 * `FirewallService` — Phase 1 of OYO-276.
 *
 * For now this is **observability only**: the Chromium webRequest
 * listener is installed at app boot, every outbound call from a
 * renderer context (fetch / XHR / WebSocket upgrade / subresource
 * load) is captured, materialised into a `RequestRecord`, and
 * broadcast to every BrowserWindow's renderer over IPC. No call is
 * blocked yet — that's wired up in Phase 4 when `PermissionService`
 * lands.
 *
 * The main-process Layer B (monkey-patched `http` / `https` / `fetch`
 * / `dns` / `net`) is Phase 3. Both layers will route through this
 * service so the console feed stays single-sourced.
 *
 * Records are broadcast unicast-style: every webContents subscribed
 * to the channel receives the same payload. The console workbench
 * tab in the renderer is the primary consumer; future surfaces
 * (audit log, status bar counter) can subscribe in parallel without
 * a fan-out service in between.
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
			try {
				const record = this.recordFromWebRequest(details)
				this.broadcast(record)
			} catch (err) {
				logger.warn('FirewallService: failed to emit RequestRecord', {
					url: details.url,
					error: String(err)
				})
			}
			// Phase 1: never block. PermissionService takes over in
			// Phase 4 by setting `cancel: true` for denied verdicts.
			callback({ cancel: false })
		})

		logger.info('FirewallService: webRequest listener installed (observability only)')
	}

	/**
	 * Build a `RequestRecord` from Electron's `OnBeforeRequestListenerDetails`.
	 * The Chromium hook only exposes the URL + method + uploadData
	 * — request headers come from `onSendHeaders` in a follow-up
	 * pass we'll add when the toast prompt needs them; Phase 1
	 * leaves the headers map empty.
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
	if (uploadData.length === 0) return undefined
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
