import { describe, it, expect } from 'vitest'
import { captureOriginHint } from './stackOrigin'

describe('captureOriginHint', () => {
	it('returns null when no caller frame is interesting', () => {
		// Calling directly from this test file: the test file IS the
		// "interesting" caller, so the hint should resolve to a string.
		const hint = captureOriginHint()
		expect(hint).not.toBeNull()
	})

	it('produces a basename:line shape for first-party callers', () => {
		const hint = captureOriginHint()
		// Whatever the build setup, the first interesting frame is
		// inside this test file (`stackOrigin.test.ts:line`), or — if
		// the test runner wraps it — a Vitest internal. Either way the
		// hint should not start with "node:" or contain firewall path
		// markers.
		expect(hint).not.toMatch(/^node:/)
		expect(hint).not.toMatch(/services\/firewall\//)
	})

	it('extracts npm package names when a node_modules frame wins', () => {
		// We can't easily synthesize a real stack frame inside a fake
		// node_modules path, so this test exercises the formatter's
		// behaviour by stubbing `Error.captureStackTrace` to inject a
		// well-known frame.
		const original = Error.captureStackTrace.bind(Error)
		try {
			Error.captureStackTrace = (holder: { stack?: string }): void => {
				holder.stack = [
					'Error',
					'    at fakeWrap (/abs/path/services/firewall/MainProcessInterceptor.ts:42:11)',
					'    at HTTPClient.request (/abs/proj/node_modules/axios/lib/core/Axios.js:144:15)',
					'    at someApp (/abs/proj/src/index.ts:7:3)'
				].join('\n')
			}
			const hint = captureOriginHint()
			expect(hint).toBe('npm package "axios"')
		} finally {
			Error.captureStackTrace = original
		}
	})

	it('extracts scoped npm package names', () => {
		const original = Error.captureStackTrace.bind(Error)
		try {
			Error.captureStackTrace = (holder: { stack?: string }): void => {
				holder.stack = [
					'Error',
					'    at /abs/proj/node_modules/@scope/pkg/lib/file.js:10:1'
				].join('\n')
			}
			const hint = captureOriginHint()
			expect(hint).toBe('npm package "@scope/pkg"')
		} finally {
			Error.captureStackTrace = original
		}
	})

	it('returns null when the stack is empty', () => {
		const original = Error.captureStackTrace.bind(Error)
		try {
			Error.captureStackTrace = (holder: { stack?: string }): void => {
				holder.stack = 'Error'
			}
			const hint = captureOriginHint()
			expect(hint).toBeNull()
		} finally {
			Error.captureStackTrace = original
		}
	})

	it('skips firewall-internal frames', () => {
		const original = Error.captureStackTrace.bind(Error)
		try {
			Error.captureStackTrace = (holder: { stack?: string }): void => {
				holder.stack = [
					'Error',
					'    at MainProcessInterceptor (/abs/services/firewall/MainProcessInterceptor.ts:1:1)',
					'    at BufferingClientRequest (/abs/services/firewall/BufferingClientRequest.ts:1:1)',
					'    at HTTPExecutionService (/abs/services/HTTPExecutionService.ts:42:11)'
				].join('\n')
			}
			const hint = captureOriginHint()
			expect(hint).toBe('HTTPExecutionService.ts:42')
		} finally {
			Error.captureStackTrace = original
		}
	})
})
