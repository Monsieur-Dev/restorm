import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { ClientRequest } from 'node:http'
import { BufferingClientRequest } from './BufferingClientRequest'

class FakeClientRequest extends EventEmitter {
	public readonly writes: { chunk: unknown; encoding?: string }[] = []
	public ended = false
	public destroyedWith: Error | undefined
	public timeout: { ms: number; cb?: () => void } | undefined
	public noDelay: boolean | undefined
	public socketKeepAlive: { enable?: boolean; initialDelay?: number } | undefined
	public destroyed = false
	public aborted = false
	public writable = true
	public writableEnded = false
	public writableFinished = false
	public reusedSocket = false
	public path: string | null = null
	public host = ''
	public protocol = ''
	public method = ''
	public socket: unknown = null

	write(chunk: unknown, encoding?: unknown, cb?: unknown): boolean {
		this.writes.push({ chunk, encoding: typeof encoding === 'string' ? encoding : undefined })
		if (typeof cb === 'function') (cb as () => void)()
		return true
	}
	end(): this {
		this.ended = true
		this.writableEnded = true
		return this
	}
	flushHeaders(): void { /* noop */ }
	cork(): void { /* noop */ }
	uncork(): void { /* noop */ }
	setTimeout(ms: number, cb?: () => void): this { this.timeout = { ms, cb }; return this }
	setNoDelay(noDelay?: boolean): void { this.noDelay = noDelay ?? true }
	setSocketKeepAlive(enable?: boolean, initialDelay?: number): void { this.socketKeepAlive = { enable, initialDelay } }
	destroy(err?: Error): this { this.destroyed = true; this.destroyedWith = err; return this }
}

function makeBuffering(opts: {
	verdict: Promise<'allow' | 'deny'>
	args?: unknown[]
	headers?: Record<string, string | string[] | number>
	denyReason?: string
}): { buffering: BufferingClientRequest; capturedArgs: () => unknown[] | null; real: () => FakeClientRequest | null } {
	let capturedArgs: unknown[] | null = null
	let real: FakeClientRequest | null = null
	const buffering = new BufferingClientRequest(
		opts.args ?? [{ host: 'example.com', headers: opts.headers }],
		opts.verdict,
		(merged: unknown[]): ClientRequest => {
			capturedArgs = merged
			real = new FakeClientRequest()
			return real as unknown as ClientRequest
		},
		opts.denyReason ?? 'denied',
		opts.headers as never
	)
	return { buffering, capturedArgs: () => capturedArgs, real: () => real }
}

async function nextTick(): Promise<void> {
	return new Promise((resolve) => { setImmediate(resolve) })
}

function deferredVerdict(): { promise: Promise<'allow' | 'deny'>; resolve: (v: 'allow' | 'deny') => void } {
	let resolve: (v: 'allow' | 'deny') => void = () => { /* replaced */ }
	const promise = new Promise<'allow' | 'deny'>((r) => { resolve = r })
	return { promise, resolve }
}

function expectReal(real: FakeClientRequest | null): FakeClientRequest {
	if (real === null) throw new Error('expected real request to be created')
	return real
}

describe('BufferingClientRequest', () => {
	it('replays buffered writes once verdict resolves to allow', async () => {
		const { promise, resolve } = deferredVerdict()
		const { buffering, real } = makeBuffering({ verdict: promise })
		buffering.write('hello ')
		buffering.write('world')
		buffering.end()
		expect(real()).toBeNull()
		resolve('allow')
		await nextTick()
		const r = expectReal(real())
		expect(r.writes).toEqual([
			{ chunk: 'hello ', encoding: undefined },
			{ chunk: 'world', encoding: undefined }
		])
		expect(r.ended).toBe(true)
	})

	it('emits EFIREWALLDENIED error when verdict resolves to deny', async () => {
		const { promise, resolve } = deferredVerdict()
		const { buffering, real } = makeBuffering({ verdict: promise, denyReason: 'firewall blocked test' })
		const errSpy = vi.fn()
		buffering.on('error', errSpy)
		resolve('deny')
		await nextTick()
		await nextTick()
		expect(errSpy).toHaveBeenCalledTimes(1)
		const err = errSpy.mock.calls[0]?.[0] as Error & { code?: string }
		expect(err.message).toBe('firewall blocked test')
		expect(err.code).toBe('EFIREWALLDENIED')
		expect(real()).toBeNull()
	})

	it('forwards setHeader/getHeader/removeHeader without a real request', () => {
		const promise = new Promise<'allow' | 'deny'>(() => { /* never resolves */ })
		const { buffering } = makeBuffering({ verdict: promise })
		buffering.setHeader('Content-Type', 'application/json')
		expect(buffering.getHeader('content-type')).toBe('application/json')
		expect(buffering.hasHeader('CONTENT-TYPE')).toBe(true)
		expect(buffering.getHeaderNames()).toContain('content-type')
		buffering.removeHeader('content-type')
		expect(buffering.getHeader('Content-Type')).toBeUndefined()
		expect(buffering.hasHeader('content-type')).toBe(false)
	})

	it('merges deferred setHeader calls into the real request args', async () => {
		const { promise, resolve } = deferredVerdict()
		const { buffering, capturedArgs } = makeBuffering({
			verdict: promise,
			args: [{ host: 'example.com', headers: { 'Existing': '1' } }],
			headers: { Existing: '1' }
		})
		buffering.setHeader('X-Late', 'true')
		resolve('allow')
		await nextTick()
		const args = capturedArgs() as { headers?: Record<string, string> }[] | null
		if (args === null) throw new Error('expected args')
		const opts = args[0]
		expect(opts?.headers).toMatchObject({ Existing: '1', 'X-Late': 'true' })
	})

	it('replays deferred setTimeout / setNoDelay / setSocketKeepAlive once the real request opens', async () => {
		const { promise, resolve } = deferredVerdict()
		const { buffering, real } = makeBuffering({ verdict: promise })
		buffering.setTimeout(2_500)
		buffering.setNoDelay(true)
		buffering.setSocketKeepAlive(true, 30_000)
		resolve('allow')
		await nextTick()
		const r = expectReal(real())
		expect(r.timeout?.ms).toBe(2_500)
		expect(r.noDelay).toBe(true)
		expect(r.socketKeepAlive).toEqual({ enable: true, initialDelay: 30_000 })
	})

	it('forwards `response` from the real request once allowed', async () => {
		const { promise, resolve } = deferredVerdict()
		const { buffering, real } = makeBuffering({ verdict: promise })
		const responseSpy = vi.fn()
		buffering.on('response', responseSpy)
		buffering.end()
		resolve('allow')
		await nextTick()
		const fakeResponse = { statusCode: 200 }
		expectReal(real()).emit('response', fakeResponse)
		expect(responseSpy).toHaveBeenCalledTimes(1)
		expect(responseSpy).toHaveBeenCalledWith(fakeResponse)
	})

	it('abort() before verdict prevents the real request from being created', async () => {
		const { promise, resolve } = deferredVerdict()
		const { buffering, real } = makeBuffering({ verdict: promise })
		buffering.abort()
		resolve('allow')
		await nextTick()
		expect(real()).toBeNull()
	})

	it('end with callback fires the callback even before the real request opens', async () => {
		const promise = new Promise<'allow' | 'deny'>(() => { /* never resolves */ })
		const { buffering } = makeBuffering({ verdict: promise })
		const cb = vi.fn()
		buffering.end(cb)
		await nextTick()
		expect(cb).toHaveBeenCalledTimes(1)
	})
})
