// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('electron', () => ({
	app: { getPath: (): string => '/tmp/ecui-firewall-harden-test-userdata' },
	BrowserWindow: { getAllWindows: (): never[] => [] }
}))

vi.mock('../LoggerService', () => ({
	logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }
}))

import net from 'node:net'
import dgram from 'node:dgram'
import {
	installHardenInterceptor,
	parseConnectArgs,
	parseDgramSendArgs,
	checkHostnameOnly
} from './HardenInterceptor'
import { permissionService } from './PermissionService'
import { firewallService } from './FirewallService'
import { withFirewallBypass } from './firewallBypass'

describe('parseConnectArgs', () => {
	it('decodes connect(port, host)', () => {
		expect(parseConnectArgs([8080, 'Example.COM'])).toEqual({ host: 'example.com', port: 8080, protocol: 'http' })
	})

	it('decodes connect(port) with default localhost host', () => {
		expect(parseConnectArgs([443])).toEqual({ host: 'localhost', port: 443, protocol: 'https' })
	})

	it('decodes connect({ port, host })', () => {
		expect(parseConnectArgs([{ port: 1883, host: 'broker.local' }])).toEqual({ host: 'broker.local', port: 1883, protocol: 'http' })
	})

	it('skips unix-socket string path', () => {
		expect(parseConnectArgs(['/var/run/app.sock'])).toBeNull()
	})

	it('skips options with a unix-socket path', () => {
		expect(parseConnectArgs([{ path: '/tmp/x.sock' }])).toBeNull()
	})

	it('returns null on empty args', () => {
		expect(parseConnectArgs([])).toBeNull()
	})

	it('infers https for 443, http for 80/8080, http otherwise', () => {
		expect(parseConnectArgs([443])?.protocol).toBe('https')
		expect(parseConnectArgs([80])?.protocol).toBe('http')
		expect(parseConnectArgs([8080])?.protocol).toBe('http')
		expect(parseConnectArgs([9999])?.protocol).toBe('http')
	})
})

describe('parseDgramSendArgs', () => {
	it('finds the port + address pair', () => {
		expect(parseDgramSendArgs([Buffer.from('x'), 53, 'DNS.example'])).toEqual({ host: 'dns.example', port: 53 })
	})

	it('finds the pair with offset/length args present', () => {
		expect(parseDgramSendArgs([Buffer.from('hello'), 0, 5, 1234, 'host.local'])).toEqual({ host: 'host.local', port: 1234 })
	})

	it('returns null when no numeric-then-string pair exists', () => {
		expect(parseDgramSendArgs([Buffer.from('x')])).toBeNull()
	})
})

describe('checkHostnameOnly', () => {
	afterEach(() => {
		const bl = permissionService.listBlacklist()
		for (const e of bl) permissionService.removeFromBlacklist(e)
	})

	it('allows an empty / non-string hostname (fail-open is fine: connect is still gated)', () => {
		expect(checkHostnameOnly('', 'main-dns')).toBe('allow')
		expect(checkHostnameOnly(undefined as unknown as string, 'main-dns')).toBe('allow')
	})

	it('allows a host that is not blacklisted', () => {
		expect(checkHostnameOnly('good.example', 'main-dns')).toBe('allow')
	})

	it('denies a blacklisted host (case-insensitive)', () => {
		permissionService.addToBlacklist({ scheme: 'http', host: 'evil.example', port: 0 })
		expect(checkHostnameOnly('EVIL.example', 'main-dns')).toBe('deny')
	})

	it('does NOT deny on a per-origin ban — that one is enforced at connect, where the port is known', () => {
		// A DNS query carries no port. Denying here on a ban that only covers
		// port 5111 would kill every other port of the same host, silently.
		permissionService.addToBlacklist({ scheme: 'http', host: 'localhost', port: 5111 })
		expect(checkHostnameOnly('localhost', 'main-dns')).toBe('allow')
	})

	it('denies a wildcard-port ban through the subdomain glob', () => {
		permissionService.addToBlacklist({ scheme: 'https', host: '*.evil.example', port: 0 })
		expect(checkHostnameOnly('api.evil.example', 'main-dns')).toBe('deny')
		// one level only, and the bare domain is not covered
		expect(checkHostnameOnly('a.b.evil.example', 'main-dns')).toBe('allow')
		expect(checkHostnameOnly('evil.example', 'main-dns')).toBe('allow')
	})

	it('lets an explicitly bypassed call resolve even under a wildcard ban', async () => {
		permissionService.addToBlacklist({ scheme: 'http', host: 'evil.example', port: 0 })
		expect(checkHostnameOnly('evil.example', 'main-dns')).toBe('deny')
		await withFirewallBypass(() => {
			expect(checkHostnameOnly('evil.example', 'main-dns')).toBe('allow')
			return Promise.resolve()
		})
	})
})

describe('installHardenInterceptor — idempotency', () => {
	it('a second install is a no-op (prototype slots unchanged)', () => {
		// `Reflect.get` reads the prototype slot as a plain value without
		// tripping the unbound-method lint rule.
		const connectSlot = (): unknown => Reflect.get(net.Socket.prototype, 'connect')
		const sendSlot = (): unknown => Reflect.get(dgram.Socket.prototype, 'send')
		installHardenInterceptor()
		const connectAfterFirst = connectSlot()
		const sendAfterFirst = sendSlot()
		installHardenInterceptor()
		expect(connectSlot()).toBe(connectAfterFirst)
		expect(sendSlot()).toBe(sendAfterFirst)
	})
})

describe('patchNetSocketConnect — honors withFirewallBypass', () => {
	beforeEach(() => {
		installHardenInterceptor()
	})

	it('short-circuits to an allow record without classifying inside a bypass', async () => {
		const classifySpy = vi.spyOn(permissionService, 'classify').mockReturnValue('prompt')
		const emitSpy = vi.spyOn(firewallService, 'emit').mockImplementation(vi.fn())
		// A loopback port that refuses fast — destroyed immediately, no real
		// traffic leaves the box.
		await withFirewallBypass(() => new Promise<void>((resolve) => {
			const sock = new net.Socket()
			sock.on('error', vi.fn())
			sock.connect(1, '127.0.0.1')
			sock.destroy()
			resolve()
		}))
		expect(classifySpy).not.toHaveBeenCalled()
		expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({ verdict: 'allow', source: 'main-net' }))
		classifySpy.mockRestore()
		emitSpy.mockRestore()
	})

	it('classifies (does NOT short-circuit) outside a bypass', () => {
		const classifySpy = vi.spyOn(permissionService, 'classify').mockReturnValue('allow')
		const emitSpy = vi.spyOn(firewallService, 'emit').mockImplementation(vi.fn())
		const sock = new net.Socket()
		sock.on('error', vi.fn())
		sock.connect(1, '127.0.0.1')
		sock.destroy()
		expect(classifySpy).toHaveBeenCalledWith(expect.objectContaining({ source: 'main-net', host: '127.0.0.1', port: 1 }))
		classifySpy.mockRestore()
		emitSpy.mockRestore()
	})
})
