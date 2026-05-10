import { EventEmitter } from 'node:events'
import type { ClientRequest, OutgoingHttpHeaders } from 'node:http'
import type { Verdict } from './PermissionService'

/**
 * Stand-in for `http.ClientRequest` that defers the actual network
 * call until the firewall verdict resolves.
 *
 * When the destination is `'prompt'` (unknown — toast pending) the
 * Layer B interceptor returns one of these instead of synchronously
 * forwarding to `originalRequest`. Caller code keeps writing /
 * piping / setting headers as normal; we accumulate everything in
 * memory and replay it once the user picks `Allow`. On `Deny` we
 * synthesise an `EFIREWALLDENIED` error on the next tick — same
 * contract as `DeniedClientRequest`.
 *
 * The implementation duck-types `ClientRequest` rather than
 * subclassing it: a real subclass would drag in
 * `http.OutgoingMessage`'s socket lifecycle which is what we're
 * trying NOT to start. Most consumers (axios, undici, node-fetch,
 * googleapis, npm deps) only touch a small surface — `write`,
 * `end`, `on('error' | 'response' | 'socket' | 'close')`,
 * `setHeader`, `getHeader`, `abort`, `destroy`, `setTimeout`. Calls
 * outside that surface fall through to no-ops.
 */

interface Bufferable {
	chunk: string | Buffer | Uint8Array
	encoding?: BufferEncoding
	cb?: (err?: Error | null) => void
}

interface ForwardListener {
	event: string
	listener: (...args: unknown[]) => void
}

const FORWARDED_EVENTS = [
	'response',
	'socket',
	'connect',
	'upgrade',
	'continue',
	'information',
	'abort',
	'close',
	'drain',
	'finish',
	'error',
	'timeout'
] as const

export class BufferingClientRequest extends EventEmitter {
	private readonly writes: Bufferable[] = []
	/**
	 * Headers staged on the wrapper. Keyed by the original (case-
	 * preserving) name; we use a `Map` instead of a plain object so
	 * `setHeader` / `removeHeader` can mutate by computed key without
	 * tripping the `no-dynamic-delete` lint rule.
	 */
	private readonly pendingHeaders = new Map<string, string | string[] | number>()
	private readonly headerKeys = new Map<string, string>()
	private pendingTimeout: { ms: number; cb?: () => void } | null = null
	private pendingNoDelay: boolean | null = null
	private pendingSocketKeepAlive: { enable?: boolean; initialDelay?: number } | null = null
	private ended = false
	private terminated = false
	private real: ClientRequest | null = null
	private fwd: ForwardListener[] | null = null

	/**
	 * Read-only mirrors of the `ClientRequest` properties consumers
	 * sometimes inspect. Tracked here so they're meaningful while the
	 * verdict is still pending; once the real request is open we
	 * delegate to its values. We deliberately don't expose
	 * `ClientRequest.aborted` / `connection` — both deprecated since
	 * Node 14/15 — so consumers shouldn't be reaching for them.
	 */
	get destroyed(): boolean { return this.real !== null ? this.real.destroyed : this.terminated }
	get writable(): boolean { return this.real !== null ? this.real.writable : !this.ended && !this.terminated }
	get writableEnded(): boolean { return this.real !== null ? this.real.writableEnded : this.ended }
	get writableFinished(): boolean { return this.real !== null ? this.real.writableFinished : false }
	get reusedSocket(): boolean { return this.real !== null ? this.real.reusedSocket : false }
	get path(): string | null { return this.real !== null ? this.real.path : null }
	get host(): string { return this.real !== null ? this.real.host : '' }
	get protocol(): string { return this.real !== null ? this.real.protocol : '' }
	get method(): string { return this.real !== null ? this.real.method : '' }
	get socket(): unknown { return this.real !== null ? this.real.socket : null }

	constructor(
		args: unknown[],
		verdictPromise: Promise<Verdict>,
		realFactory: (mergedArgs: unknown[]) => ClientRequest,
		denyReason: string,
		initialHeaders: OutgoingHttpHeaders | undefined
	) {
		super()
		// Initialise the pending-header map from the caller's
		// `options.headers` so `getHeader()` sees them before the
		// real request is open. Header names are stored case-
		// preserving in `pendingHeaders` (mirrors the real
		// ClientRequest behaviour) but case-folded in `headerKeys`
		// for case-insensitive lookups.
		if (initialHeaders !== undefined) {
			for (const [k, v] of Object.entries(initialHeaders)) {
				if (v === undefined) continue
				this.pendingHeaders.set(k, v)
				this.headerKeys.set(k.toLowerCase(), k)
			}
		}

		verdictPromise.then(
			(verdict) => {
				if (this.terminated) return
				if (verdict === 'deny') {
					this.terminated = true
					this.flushDenyError(denyReason)
					return
				}
				try {
					const mergedArgs = this.applyPendingHeadersToArgs(args)
					const real = realFactory(mergedArgs)
					this.real = real
					if (this.pendingTimeout !== null) real.setTimeout(this.pendingTimeout.ms, this.pendingTimeout.cb)
					if (this.pendingNoDelay !== null) real.setNoDelay(this.pendingNoDelay)
					if (this.pendingSocketKeepAlive !== null) {
						real.setSocketKeepAlive(this.pendingSocketKeepAlive.enable, this.pendingSocketKeepAlive.initialDelay)
					}
					this.bridgeEvents(real)
					for (const w of this.writes) real.write(w.chunk, w.encoding, w.cb)
					if (this.ended) real.end()
				} catch (err) {
					this.terminated = true
					this.flushAdoptError(err)
				}
			},
			(err: unknown) => {
				this.terminated = true
				this.flushAdoptError(err)
			}
		)
	}

	write(chunk: string | Buffer | Uint8Array, encoding?: BufferEncoding | ((err?: Error | null) => void), cb?: (err?: Error | null) => void): boolean {
		if (this.terminated) return false
		const enc = typeof encoding === 'function' ? undefined : encoding
		const callback = typeof encoding === 'function' ? encoding : cb
		this.writes.push({ chunk, encoding: enc, cb: callback })
		return true
	}

	end(chunk?: string | Buffer | Uint8Array | (() => void), encoding?: BufferEncoding | ((err?: Error | null) => void), cb?: (err?: Error | null) => void): this {
		if (this.terminated) return this
		if (typeof chunk === 'function') {
			this.ended = true
			setImmediate(chunk)
			return this
		}
		if (chunk !== undefined) {
			const enc = typeof encoding === 'function' ? undefined : encoding
			const callback = typeof encoding === 'function' ? encoding : cb
			this.writes.push({ chunk, encoding: enc, cb: callback })
		}
		this.ended = true
		return this
	}

	setHeader(name: string, value: string | string[] | number): this {
		const existing = this.headerKeys.get(name.toLowerCase())
		if (existing !== undefined && existing !== name) this.pendingHeaders.delete(existing)
		this.pendingHeaders.set(name, value)
		this.headerKeys.set(name.toLowerCase(), name)
		return this
	}

	getHeader(name: string): string | string[] | number | undefined {
		const key = this.headerKeys.get(name.toLowerCase())
		if (key === undefined) return undefined
		return this.pendingHeaders.get(key)
	}

	removeHeader(name: string): void {
		const key = this.headerKeys.get(name.toLowerCase())
		if (key === undefined) return
		this.pendingHeaders.delete(key)
		this.headerKeys.delete(name.toLowerCase())
	}

	getHeaderNames(): string[] {
		return Array.from(this.headerKeys.keys())
	}

	getHeaders(): OutgoingHttpHeaders {
		const out: OutgoingHttpHeaders = {}
		for (const [k, v] of this.pendingHeaders) out[k] = v
		return out
	}

	hasHeader(name: string): boolean {
		return this.headerKeys.has(name.toLowerCase())
	}

	flushHeaders(): void {
		if (this.real !== null) this.real.flushHeaders()
	}

	cork(): void { if (this.real !== null) this.real.cork() }
	uncork(): void { if (this.real !== null) this.real.uncork() }

	setTimeout(timeout: number, callback?: () => void): this {
		if (this.real !== null) this.real.setTimeout(timeout, callback)
		else this.pendingTimeout = { ms: timeout, cb: callback }
		return this
	}

	setNoDelay(noDelay?: boolean): void {
		if (this.real !== null) this.real.setNoDelay(noDelay)
		else this.pendingNoDelay = noDelay ?? true
	}

	setSocketKeepAlive(enable?: boolean, initialDelay?: number): void {
		if (this.real !== null) this.real.setSocketKeepAlive(enable, initialDelay)
		else this.pendingSocketKeepAlive = { enable, initialDelay }
	}

	abort(): void {
		// Caller surface still names this `abort()` because that's the
		// classic `ClientRequest` API (lots of npm packages call it),
		// but internally we use `destroy()` on the real request — the
		// modern equivalent — so the deprecated `abort` Node API never
		// fires from our patches.
		this.terminated = true
		if (this.real !== null) this.real.destroy()
	}

	destroy(err?: Error): this {
		this.terminated = true
		if (this.real !== null) this.real.destroy(err)
		return this
	}

	private flushDenyError(reason: string): void {
		const err = new Error(reason)
		;(err as Error & { code?: string }).code = 'EFIREWALLDENIED'
		setImmediate(() => {
			this.emit('error', err)
			this.emit('close')
		})
	}

	private flushAdoptError(err: unknown): void {
		const wrapped = err instanceof Error ? err : new Error(String(err))
		setImmediate(() => {
			this.emit('error', wrapped)
			this.emit('close')
		})
	}

	private bridgeEvents(real: ClientRequest): void {
		const fwd: ForwardListener[] = []
		for (const event of FORWARDED_EVENTS) {
			const listener = (...payload: unknown[]): void => {
				this.emit(event, ...payload)
			}
			real.on(event, listener)
			fwd.push({ event, listener })
		}
		this.fwd = fwd
	}

	/**
	 * Merge `pendingHeaders` into the options object inside `args`,
	 * returning a new args array suitable to forward to the real
	 * `http.request`. The original args array isn't mutated — npm
	 * packages sometimes reuse the same options object across calls
	 * and we don't want a header set on call A to leak into call B.
	 */
	private applyPendingHeadersToArgs(args: unknown[]): unknown[] {
		if (this.pendingHeaders.size === 0) return args
		const merged: OutgoingHttpHeaders = {}
		for (const [k, v] of this.pendingHeaders) merged[k] = v
		const out = args.slice()
		const optsIdx = out.findIndex((a) => typeof a === 'object' && a !== null && !(a instanceof URL) && typeof a !== 'function')
		if (optsIdx === -1) {
			out.unshift({ headers: merged })
			return out
		}
		const opts = out[optsIdx] as { headers?: OutgoingHttpHeaders }
		out[optsIdx] = { ...opts, headers: { ...(opts.headers ?? {}), ...merged } }
		return out
	}
}
