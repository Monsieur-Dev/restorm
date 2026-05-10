import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
	app: { getPath: (): string => '/tmp/restorm-test-userdata' },
	BrowserWindow: { getAllWindows: (): never[] => [] }
}))

vi.mock('electron-core-ui', () => ({
	logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
	graphQLService: { getEndpoint: (): string => 'http://localhost:9100/graphql' }
}))

import http from 'node:http'
import https from 'node:https'
import { installMainProcessInterceptor } from './MainProcessInterceptor'

describe('installMainProcessInterceptor — idempotency', () => {
	it('a second install is a no-op (function references unchanged)', () => {
		installMainProcessInterceptor()
		const httpRequestAfterFirst = http.request
		const httpsRequestAfterFirst = https.request
		const fetchAfterFirst = globalThis.fetch
		installMainProcessInterceptor()
		expect(http.request).toBe(httpRequestAfterFirst)
		expect(https.request).toBe(httpsRequestAfterFirst)
		expect(globalThis.fetch).toBe(fetchAfterFirst)
	})
})
