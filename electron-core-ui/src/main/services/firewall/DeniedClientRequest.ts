import { EventEmitter } from 'node:events'

/**
 * Stand-in for `http.ClientRequest` when the firewall denies the
 * call before the underlying socket is opened. We can't return the
 * real `ClientRequest` (that would actually make the network call
 * — defeating the purpose), so we hand back an EventEmitter that
 * mimics enough of the surface to keep typical callers
 * (`req.on('error', …)`, `req.write(…)`, `req.end()`,
 * `req.destroy()`, `req.setTimeout(…)`) running without crashing.
 *
 * The 'error' event fires on `setImmediate` so the caller has time
 * to attach its listener — node's `http.ClientRequest` follows the
 * same contract for synchronous resolution failures.
 *
 * Not everything maps perfectly:
 *   - `pipe(srcStream, deniedReq)` won't reach an underlying socket
 *     and will swallow data. Most consumers don't pipe-into a
 *     ClientRequest in a single sync expression — they call
 *     `.write(chunk)` after attaching `.on('error', …)`, which we
 *     handle correctly.
 *   - Methods that the caller might chain through aren't true
 *     `Writable` returns; we return `this` so chains don't crash.
 */
export class DeniedClientRequest extends EventEmitter {
	private destroyed = false

	constructor(reason: string) {
		super()
		setImmediate(() => {
			if (this.destroyed) return
			const err = new Error(reason)
			;(err as Error & { code?: string }).code = 'EFIREWALLDENIED'
			this.emit('error', err)
			this.emit('close')
		})
	}

	write(_chunk?: unknown, _encoding?: unknown, callback?: unknown): boolean {
		// Emit drain on the next tick so callers that wait on it
		// don't hang. Most http clients ignore the return value of
		// .write() entirely.
		if (typeof callback === 'function') setImmediate(() => { (callback as () => void)() })
		return true
	}

	end(_chunk?: unknown, _encoding?: unknown, callback?: unknown): this {
		if (typeof callback === 'function') setImmediate(() => { (callback as () => void)() })
		return this
	}

	destroy(_err?: Error): this {
		this.destroyed = true
		return this
	}

	abort(): void {
		this.destroy()
	}

	setTimeout(_timeout: number, _callback?: () => void): this { return this }
	setNoDelay(_value?: boolean): this { return this }
	setSocketKeepAlive(_enable?: boolean, _initialDelay?: number): this { return this }
	setHeader(_name: string, _value: string | string[]): this { return this }
	getHeader(_name: string): string | string[] | undefined { return undefined }
	removeHeader(_name: string): void { /* no-op */ }
	getHeaderNames(): string[] { return [] }
	getHeaders(): Record<string, string | string[]> { return {} }
	hasHeader(_name: string): boolean { return false }
	flushHeaders(): void { /* no-op */ }
	cork(): void { /* no-op */ }
	uncork(): void { /* no-op */ }
}
