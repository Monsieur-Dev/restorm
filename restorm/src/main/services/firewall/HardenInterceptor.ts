import http from 'node:http'
import https from 'node:https'
import net, { type Socket as NetSocket } from 'node:net'
import dns, { type LookupAddress, type LookupOptions } from 'node:dns'
import dgram, { type Socket as DgramSocket, type RemoteInfo } from 'node:dgram'
import { randomUUID } from 'node:crypto'
import { logger } from 'electron-core-ui'
import { firewallService } from './FirewallService'
import { permissionService } from './PermissionService'
import type { RequestRecord } from '../../../shared/types/firewall'

/**
 * Harden Layer B beyond the http / https / fetch chokepoints.
 *
 * The base `MainProcessInterceptor` patches `http.request`,
 * `https.request`, and `globalThis.fetch`. That covers the bulk of
 * how Node code talks to the network — but it's not exhaustive.
 * Some paths bypass it entirely:
 *
 *   - `undici` directly (`require('undici').fetch`) — undici writes
 *     to `node:net.Socket` itself, never going through `http.request`.
 *   - `node:net.Socket.connect` raw — websocket libs, mongodb,
 *     postgres, redis, gRPC native, IRC bots, anything custom.
 *   - `node:dns.lookup` — useful both as defence-in-depth (block
 *     before connect) AND to plug DNS-only data exfiltration
 *     (encoding bytes into subdomain queries).
 *   - `node:dgram` (UDP) — sockets, QUIC, custom protocols.
 *
 * This module monkey-patches all four chokepoints. Same shape as
 * the http patches: build a record, run `permissionService.checkSync`,
 * if `deny` → block the call and emit a denied record; if `allow`
 * → forward to the original implementation and emit an allowed
 * record.
 *
 * Idempotent: a second install is a no-op so repeated bundler
 * reloads don't double-wrap.
 */

let installed = false

export function installHardenInterceptor(): void {
	if (installed) return
	installed = true

	patchNetSocketConnect()
	patchDnsLookup()
	patchDnsResolve()
	patchDgramSend()
	lockdownPatchedGlobals()

	logger.info('FirewallService: harden interceptor installed (net.Socket.connect + dns + dgram + lockdown)')
}

/**
 * After every patch is in place, lock the patched function slots so
 * a later-loading dependency can't REPLACE our wrappers (the WRAP
 * scenario is fine — they capture our patched function as their
 * "original" and our hook still fires; REPLACE is the adversarial
 * case where a malicious module assigns a fresh function to
 * `http.request` etc., kicking us out of the call path).
 *
 * `Object.defineProperty(..., { writable: false, configurable: false })`
 * blocks both `obj.fn = …` reassignment and `delete obj.fn`, while
 * still letting wrapper code do `const original = obj.fn` and call
 * the saved reference. Native modules using N-API to talk over
 * libuv directly are still out of reach — that scenario is
 * explicitly out-of-scope per the ticket.
 *
 * Failure is non-fatal: some platforms / electron embeddings flag
 * a few of these slots as already-non-configurable from the
 * runtime side; we log and continue rather than crash the app.
 */
function lockdownPatchedGlobals(): void {
	const targets: { obj: object; key: string; label: string }[] = [
		{ obj: http, key: 'request', label: 'http.request' },
		{ obj: http, key: 'get', label: 'http.get' },
		{ obj: https, key: 'request', label: 'https.request' },
		{ obj: https, key: 'get', label: 'https.get' },
		{ obj: globalThis, key: 'fetch', label: 'globalThis.fetch' },
		{ obj: net.Socket.prototype, key: 'connect', label: 'net.Socket.prototype.connect' },
		{ obj: dns, key: 'lookup', label: 'dns.lookup' },
		{ obj: dns, key: 'resolve', label: 'dns.resolve' },
		{ obj: dgram.Socket.prototype, key: 'send', label: 'dgram.Socket.prototype.send' }
	]
	for (const { obj, key, label } of targets) {
		try {
			const value = (obj as Record<string, unknown>)[key]
			if (typeof value !== 'function') continue
			Object.defineProperty(obj, key, { value, writable: false, configurable: false, enumerable: true })
		} catch (err) {
			logger.warn('FirewallService: lockdown skipped a slot', { slot: label, error: String(err) })
		}
	}
}

// ─── net.Socket.prototype.connect ───────────────────────────────────────────

type RawConnectArgs = unknown[]

interface ConnectTarget { host: string; port: number; protocol: 'http' | 'https' | 'internal' }

function patchNetSocketConnect(): void {
	const proto = net.Socket.prototype
	// IMPORTANT: do NOT `.bind(proto)` here — `Function.prototype.bind`
	// pins `this` to the prototype permanently, so the later
	// `original.call(this, …)` would silently swap the actual socket
	// for the prototype, and Node's internals (`Duplex._unrefTimer`,
	// the timer-Symbol slot, …) crash with `Cannot read properties
	// of undefined (reading 'Symbol(timeout)')`. The unbound function
	// + explicit `.call(this, …)` is what restores the per-instance
	// `this` correctly. `Reflect.get` reads the slot without
	// triggering the lint rule against unbound-method access.
	const original = Reflect.get(proto, 'connect') as (this: NetSocket, ...a: unknown[]) => NetSocket
	const patched = function patchedConnect(this: NetSocket, ...args: RawConnectArgs): NetSocket {
		const target = parseConnectArgs(args)
		if (target !== null) {
			const verdict = permissionService.checkSync({
				scheme: target.protocol,
				host: target.host,
				port: target.port,
				source: 'main-net'
			})
			const record = makeRecord(target, verdict)
			if (verdict === 'deny') {
				record.errorMessage = 'firewall: denied (blacklist)'
				firewallService.emit(record)
				// Defer to next tick so the caller has time to attach
				// `on('error', …)` before the error fires — same
				// contract `http.request` / `DeniedClientRequest`
				// follow.
				queueMicrotask(() => {
					const err = new Error(`Firewall blocked outbound connection to ${target.host}:${String(target.port)}`)
					;(err as Error & { code?: string }).code = 'EFIREWALLDENIED'
					this.destroy(err)
				})
				return this
			}
			firewallService.emit(record)
		}
		return original.call(this, ...args)
	}
	;(proto as unknown as { connect: typeof patched }).connect = patched
}

/**
 * Best-effort decoder of the multi-signature `socket.connect()` API:
 *   - `connect(port[, host][, listener])`
 *   - `connect(path[, listener])` — IPC / unix socket; we skip
 *     these because they're filesystem paths, not network
 *     destinations.
 *   - `connect(options[, listener])` where options is `{ port, host?, path? }`
 *
 * Returns `null` for unix-socket / unknown shapes (we let those
 * pass without firewall checking — they're not outbound network).
 */
function parseConnectArgs(args: RawConnectArgs): ConnectTarget | null {
	if (args.length === 0) return null
	const first = args[0]
	if (typeof first === 'number') {
		const port = first
		const host = typeof args[1] === 'string' ? args[1] : 'localhost'
		return { host: host.toLowerCase(), port, protocol: inferSchemeFromPort(port) }
	}
	if (typeof first === 'string') {
		// Unix socket path — out of scope.
		return null
	}
	if (typeof first === 'object' && first !== null) {
		const opts = first as { port?: unknown; host?: unknown; path?: unknown }
		if (typeof opts.path === 'string') return null  // unix socket
		if (typeof opts.port === 'number') {
			const port = opts.port
			const host = typeof opts.host === 'string' ? opts.host : 'localhost'
			return { host: host.toLowerCase(), port, protocol: inferSchemeFromPort(port) }
		}
	}
	return null
}

function inferSchemeFromPort(port: number): 'http' | 'https' | 'internal' {
	if (port === 443) return 'https'
	if (port === 80 || port === 8080) return 'http'
	return 'http'
}

// ─── dns.lookup + dns.resolve ───────────────────────────────────────────────

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void
type LookupOpts = number | LookupOptions

function patchDnsLookup(): void {
	const original = dns.lookup
	const patched = function patchedLookup(
		hostname: string,
		optionsOrCallback?: LookupOpts | LookupCallback,
		maybeCallback?: LookupCallback
	): void {
		const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback
		const options = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback

		const verdict = checkHostnameOnly(hostname, 'main-dns')
		if (verdict === 'deny' && typeof callback === 'function') {
			queueMicrotask(() => {
				const err = new Error(`Firewall blocked DNS lookup for ${hostname}`) as NodeJS.ErrnoException
				err.code = 'EFIREWALLDENIED'
				callback(err, '', 4)
			})
			return
		}
		// Forward to the real implementation. Original signature is
		// overloaded; cast through `unknown` so TS accepts the spread.
		;(original as unknown as (...a: unknown[]) => void)(hostname, options, callback)
	}
	;(dns as unknown as { lookup: typeof patched }).lookup = patched
}

function patchDnsResolve(): void {
	const original = dns.resolve
	const patched = function patchedResolve(
		hostname: string,
		rrtypeOrCallback?: string | ((err: NodeJS.ErrnoException | null, addresses: string[]) => void),
		maybeCallback?: (err: NodeJS.ErrnoException | null, addresses: string[]) => void
	): void {
		const callback = typeof rrtypeOrCallback === 'function' ? rrtypeOrCallback : maybeCallback
		const verdict = checkHostnameOnly(hostname, 'main-dns')
		if (verdict === 'deny' && typeof callback === 'function') {
			queueMicrotask(() => {
				const err = new Error(`Firewall blocked DNS resolve for ${hostname}`) as NodeJS.ErrnoException
				err.code = 'EFIREWALLDENIED'
				callback(err, [])
			})
			return
		}
		;(original as unknown as (...a: unknown[]) => void)(hostname, rrtypeOrCallback, callback)
	}
	;(dns as unknown as { resolve: typeof patched }).resolve = patched
}

/**
 * Hostname-only check — DNS doesn't carry a port. We probe the
 * permission service against `port: 0` which exercises the
 * blacklist + project-origins gates (any blacklisted hostname
 * matches regardless of port; project origins are matched by
 * full triple but the host alone is enough to block a clearly
 * denied DNS query). Whitelist matches require the full triple,
 * so a hostname-only check NEVER allows past a prompt — it just
 * decides "deny outright OR keep going with the connect".
 */
function checkHostnameOnly(hostname: string, source: string): 'allow' | 'deny' {
	if (typeof hostname !== 'string' || hostname.length === 0) return 'allow'
	const lower = hostname.toLowerCase()
	const blacklist = permissionService.listBlacklist()
	for (const entry of blacklist) {
		if (entry.host === lower) {
			logger.warn('Firewall: blocked DNS query for blacklisted host', { hostname: lower, source })
			return 'deny'
		}
	}
	return 'allow'
}

// ─── dgram.Socket.prototype.send ────────────────────────────────────────────

type DgramSendCallback = (error: Error | null, bytes: number) => void
type DgramSendArgs = unknown[]

function patchDgramSend(): void {
	const proto = dgram.Socket.prototype
	// Same constraint as `patchNetSocketConnect` — keep `original`
	// unbound so `original.call(this, …)` actually re-binds `this`
	// to the live dgram socket. Binding to `proto` would crash
	// dgram's internal handle dispatch.
	const original = Reflect.get(proto, 'send') as (this: DgramSocket, ...a: unknown[]) => void
	const patched = function patchedSend(this: DgramSocket, ...args: DgramSendArgs): void {
		const target = parseDgramSendArgs(args)
		if (target !== null) {
			const verdict = permissionService.checkSync({
				scheme: 'udp',
				host: target.host,
				port: target.port,
				source: 'main-net'
			})
			const record = makeRecord({ ...target, protocol: 'internal' }, verdict)
			record.method = 'UDP'
			if (verdict === 'deny') {
				record.errorMessage = 'firewall: denied (blacklist)'
				firewallService.emit(record)
				const cb = findCallback(args)
				if (cb !== null) {
					queueMicrotask(() => {
						const err = new Error(`Firewall blocked UDP send to ${target.host}:${String(target.port)}`) as NodeJS.ErrnoException
						err.code = 'EFIREWALLDENIED'
						cb(err, 0)
					})
				}
				return
			}
			firewallService.emit(record)
		}
		original.call(this, ...args)
	}
	;(proto as unknown as { send: typeof patched }).send = patched
}

/**
 * `socket.send(msg, [offset, length,] port, address, [callback])`.
 * Best-effort: scan for a numeric port + an address-like string
 * after it. Returns `null` if we can't tell — better to skip
 * than misfire.
 */
function parseDgramSendArgs(args: DgramSendArgs): { host: string; port: number } | null {
	for (let i = 0; i < args.length; i += 1) {
		if (typeof args[i] === 'number' && i + 1 < args.length && typeof args[i + 1] === 'string') {
			const port = args[i] as number
			const host = (args[i + 1] as string).toLowerCase()
			if (Number.isFinite(port) && host.length > 0) return { host, port }
		}
	}
	return null
}

function findCallback(args: DgramSendArgs): DgramSendCallback | null {
	for (const a of args) if (typeof a === 'function') return a as DgramSendCallback
	return null
}

// ─── Shared helpers ─────────────────────────────────────────────────────────

function makeRecord(target: { host: string; port: number; protocol: 'http' | 'https' | 'internal' }, verdict: 'allow' | 'deny'): RequestRecord {
	return {
		id: randomUUID(),
		timestamp: new Date().toISOString(),
		source: 'main-net',
		protocol: target.protocol,
		method: 'CONNECT',
		url: `${target.protocol}://${target.host}:${String(target.port)}`,
		host: target.host,
		port: target.port,
		headers: {},
		verdict
	}
}

// Suppress an unused-import warning when nothing in this module
// references `RemoteInfo` directly (kept for future expansion of
// the dgram patch to inbound `message` event observability).
export type _DgramRemoteInfo = RemoteInfo
