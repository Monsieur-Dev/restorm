import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
	app: { getPath: (): string => '/tmp/ecui-firewall-test-userdata' },
	BrowserWindow: { getAllWindows: (): never[] => [] }
}))

vi.mock('../LoggerService', () => ({
	logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }
}))

import http from 'node:http'
import https from 'node:https'
import { installMainProcessInterceptor } from './MainProcessInterceptor'
import { permissionService } from './PermissionService'
import { firewallService } from './FirewallService'
import { withFirewallBypass } from './firewallBypass'
import { BufferingClientRequest } from './BufferingClientRequest'

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

describe('patchHttpModule — honors withFirewallBypass', () => {
	// A loopback port that refuses fast; the request errors immediately and is
	// destroyed, so no real traffic leaves the box.
	const refused = { hostname: '127.0.0.1', port: 1, method: 'GET' as const }

	it('a host that would prompt is buffered (prompt path) outside any bypass', () => {
		installMainProcessInterceptor()
		const classifySpy = vi.spyOn(permissionService, 'classify').mockReturnValue('prompt')
		// `check` would await the user's verdict — keep it pending so nothing
		// further fires; we only assert the request was buffered, not allowed.
		const checkSpy = vi.spyOn(permissionService, 'check').mockReturnValue(new Promise(() => undefined))
		const req = http.request(refused)
		req.on('error', vi.fn())
		expect(req).toBeInstanceOf(BufferingClientRequest)
		expect(classifySpy).toHaveBeenCalled()
		classifySpy.mockRestore()
		checkSpy.mockRestore()
	})

	it('short-circuits to allow (real request, not buffered) inside withFirewallBypass', async () => {
		installMainProcessInterceptor()
		// Force the would-be verdict to `prompt` so only the bypass can keep it
		// off the prompt path.
		const classifySpy = vi.spyOn(permissionService, 'classify').mockReturnValue('prompt')
		const emitSpy = vi.spyOn(firewallService, 'emit').mockImplementation(vi.fn())
		let req: http.ClientRequest | undefined
		await withFirewallBypass(
			() =>
				new Promise<void>((resolve) => {
					req = http.request(refused)
					req.on('error', vi.fn())
					req.destroy()
					resolve()
				})
		)
		expect(req).not.toBeInstanceOf(BufferingClientRequest)
		expect(classifySpy).not.toHaveBeenCalled()
		expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({ verdict: 'allow' }))
		classifySpy.mockRestore()
		emitSpy.mockRestore()
	})
})
