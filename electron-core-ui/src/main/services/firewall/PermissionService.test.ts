import { describe, it, expect, vi, beforeEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'

vi.mock('electron', () => {
	const path = mkdtempSync(join(tmpdir(), 'ecui-fw-test-'))
	return {
		app: {
			getPath: (): string => path,
			isReady: (): boolean => true
		},
		BrowserWindow: {
			getAllWindows: (): never[] => []
		}
	}
})

vi.mock('../LoggerService', () => ({
	logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }
}))

import { permissionService } from './PermissionService'

beforeEach(() => {
	for (const o of permissionService.listWhitelist()) permissionService.removeFromWhitelist(o)
	for (const o of permissionService.listBlacklist()) permissionService.removeFromBlacklist(o)
	for (const h of permissionService.listSystemAllowedHosts()) permissionService.removeSystemAllowedHost(h)
	for (const e of permissionService.listSystemEndpoints()) permissionService.undeclareSystemEndpoint(e.id)
	permissionService.setProjectOrigins([])
	permissionService.setInfraPorts({ graphqlPort: null, mcpPort: null, viteDevPort: null })
})

describe('PermissionService.classify', () => {
	it('allows whitelisted origins immediately', () => {
		permissionService.addToWhitelist({ scheme: 'https', host: 'example.com', port: 443 })
		expect(
			permissionService.classify({ scheme: 'https', host: 'example.com', port: 443, source: 'main-https' })
		).toBe('allow')
	})

	it('denies blacklisted origins immediately', () => {
		permissionService.addToBlacklist({ scheme: 'http', host: 'evil.com', port: 80 })
		expect(
			permissionService.classify({ scheme: 'http', host: 'evil.com', port: 80, source: 'main-http' })
		).toBe('deny')
	})

	it('returns prompt for unknown origins', () => {
		expect(
			permissionService.classify({ scheme: 'https', host: 'unknown.example', port: 443, source: 'main-https' })
		).toBe('prompt')
	})

	it('allows project-derived origins without a whitelist entry', () => {
		permissionService.setProjectOrigins([{ scheme: 'https', host: 'project.example', port: 443 }])
		expect(
			permissionService.classify({ scheme: 'https', host: 'project.example', port: 443, source: 'main-https' })
		).toBe('allow')
	})

	it('treats whitelist + project-origins as a union — whitelist trumps blacklist', () => {
		permissionService.addToBlacklist({ scheme: 'https', host: 'shared.example', port: 443 })
		permissionService.addToWhitelist({ scheme: 'https', host: 'shared.example', port: 443 })
		expect(
			permissionService.classify({ scheme: 'https', host: 'shared.example', port: 443, source: 'main-https' })
		).toBe('allow')
	})

	it('host comparison is case-insensitive', () => {
		permissionService.addToWhitelist({ scheme: 'https', host: 'example.com', port: 443 })
		expect(
			permissionService.classify({ scheme: 'https', host: 'EXAMPLE.COM', port: 443, source: 'main-https' })
		).toBe('allow')
	})

	it('different ports for the same host are distinct decisions', () => {
		permissionService.addToWhitelist({ scheme: 'https', host: 'example.com', port: 443 })
		expect(
			permissionService.classify({ scheme: 'https', host: 'example.com', port: 8443, source: 'main-https' })
		).toBe('prompt')
	})

	it('allows infrastructure ports on localhost', () => {
		permissionService.setInfraPorts({ graphqlPort: 9100, mcpPort: 9200, viteDevPort: 5173 })
		expect(
			permissionService.classify({ scheme: 'http', host: 'localhost', port: 9100, source: 'main-http' })
		).toBe('allow')
		expect(
			permissionService.classify({ scheme: 'http', host: '127.0.0.1', port: 9200, source: 'main-http' })
		).toBe('allow')
	})

	it('does NOT allow other localhost ports', () => {
		permissionService.setInfraPorts({ graphqlPort: 9100, mcpPort: null, viteDevPort: null })
		expect(
			permissionService.classify({ scheme: 'http', host: 'localhost', port: 8080, source: 'main-http' })
		).toBe('prompt')
	})

	it('clears blacklist entry when adding to whitelist (and vice versa)', () => {
		permissionService.addToBlacklist({ scheme: 'https', host: 'flip.example', port: 443 })
		permissionService.addToWhitelist({ scheme: 'https', host: 'flip.example', port: 443 })
		expect(permissionService.listBlacklist()).toHaveLength(0)
		permissionService.addToBlacklist({ scheme: 'https', host: 'flip.example', port: 443 })
		expect(permissionService.listWhitelist()).toHaveLength(0)
	})

	it('listWhitelist returns sorted entries', () => {
		permissionService.addToWhitelist({ scheme: 'https', host: 'b.example', port: 443 })
		permissionService.addToWhitelist({ scheme: 'https', host: 'a.example', port: 443 })
		const list = permissionService.listWhitelist()
		expect(list[0]?.host).toBe('a.example')
		expect(list[1]?.host).toBe('b.example')
	})
})

describe('PermissionService.classify — wildcards', () => {
	it('subdomain wildcard matches one level deep', () => {
		permissionService.addToWhitelist({ scheme: 'https', host: '*.example.com', port: 443 })
		expect(
			permissionService.classify({ scheme: 'https', host: 'api.example.com', port: 443, source: 'main-https' })
		).toBe('allow')
	})

	it('subdomain wildcard does NOT match the bare domain', () => {
		permissionService.addToWhitelist({ scheme: 'https', host: '*.example.com', port: 443 })
		expect(
			permissionService.classify({ scheme: 'https', host: 'example.com', port: 443, source: 'main-https' })
		).toBe('prompt')
	})

	it('subdomain wildcard does NOT match deeper subdomains', () => {
		permissionService.addToWhitelist({ scheme: 'https', host: '*.example.com', port: 443 })
		expect(
			permissionService.classify({ scheme: 'https', host: 'a.b.example.com', port: 443, source: 'main-https' })
		).toBe('prompt')
	})

	it('wildcard host still requires the same port unless port wildcard is used', () => {
		permissionService.addToWhitelist({ scheme: 'https', host: '*.example.com', port: 443 })
		expect(
			permissionService.classify({ scheme: 'https', host: 'api.example.com', port: 8443, source: 'main-https' })
		).toBe('prompt')
	})

	it('port wildcard (port: 0) matches any real port', () => {
		permissionService.addToWhitelist({ scheme: 'https', host: 'api.example.com', port: 0 })
		expect(
			permissionService.classify({ scheme: 'https', host: 'api.example.com', port: 443, source: 'main-https' })
		).toBe('allow')
		expect(
			permissionService.classify({ scheme: 'https', host: 'api.example.com', port: 8443, source: 'main-https' })
		).toBe('allow')
	})

	it('host AND port wildcards combine', () => {
		permissionService.addToWhitelist({ scheme: 'https', host: '*.example.com', port: 0 })
		expect(
			permissionService.classify({ scheme: 'https', host: 'api.example.com', port: 8443, source: 'main-https' })
		).toBe('allow')
	})

	it('whitelist wildcard beats a more specific blacklist entry (ordering: whitelist → blacklist)', () => {
		// Documents the current precedence: whitelist matches are checked
		// FIRST, so a wildcard whitelist entry effectively shadows any
		// explicit blacklist entry that would have matched the same host.
		// Surprising but consistent — the user can always remove the
		// wildcard whitelist if they want the blacklist to bite.
		permissionService.addToWhitelist({ scheme: 'https', host: '*.example.com', port: 443 })
		permissionService.addToBlacklist({ scheme: 'https', host: 'tracker.example.com', port: 443 })
		expect(
			permissionService.classify({ scheme: 'https', host: 'tracker.example.com', port: 443, source: 'main-https' })
		).toBe('allow')
	})

	it('rejects malformed wildcard hosts on add (no entry persisted)', () => {
		permissionService.addToWhitelist({ scheme: 'https', host: '*example.com', port: 443 })
		permissionService.addToWhitelist({ scheme: 'https', host: '*.', port: 443 })
		permissionService.addToWhitelist({ scheme: 'https', host: 'api.*.com', port: 443 })
		permissionService.addToWhitelist({ scheme: 'https', host: '*.*.example.com', port: 443 })
		expect(permissionService.listWhitelist()).toHaveLength(0)
	})
})

describe('PermissionService — system-allowed hosts (display / system assets, e.g. avatar CDN)', () => {
	it('auto-allows a system-allowed host over HTTPS on any port, without a whitelist entry', () => {
		permissionService.addSystemAllowedHost('lh3.googleusercontent.com')
		// https on the standard 443 and any other port both pass — these are fixed
		// display assets fetched over https; the port isn't pinned.
		expect(
			permissionService.classify({ scheme: 'https', host: 'lh3.googleusercontent.com', port: 443, source: 'main-https' })
		).toBe('allow')
		expect(
			permissionService.classify({ scheme: 'https', host: 'lh3.googleusercontent.com', port: 8443, source: 'main-https' })
		).toBe('allow')
	})

	it('does NOT auto-allow plaintext http to a system-allowed host (https-only exemption)', () => {
		permissionService.addSystemAllowedHost('lh3.googleusercontent.com')
		expect(
			permissionService.classify({ scheme: 'http', host: 'lh3.googleusercontent.com', port: 80, source: 'main-http' })
		).toBe('prompt')
	})

	it('is case-insensitive on the host', () => {
		permissionService.addSystemAllowedHost('LH3.GoogleUserContent.com')
		expect(
			permissionService.classify({ scheme: 'https', host: 'lh3.googleusercontent.com', port: 443, source: 'main-https' })
		).toBe('allow')
	})

	it('only the exact host is exempted — a different host still prompts', () => {
		permissionService.addSystemAllowedHost('lh3.googleusercontent.com')
		expect(
			permissionService.classify({ scheme: 'https', host: 'evil.example', port: 443, source: 'main-https' })
		).toBe('prompt')
	})

	it('removing the host (e.g. on logout) drops the exemption — back to prompt', () => {
		permissionService.addSystemAllowedHost('avatars.githubusercontent.com')
		expect(
			permissionService.classify({ scheme: 'https', host: 'avatars.githubusercontent.com', port: 443, source: 'main-https' })
		).toBe('allow')
		permissionService.removeSystemAllowedHost('avatars.githubusercontent.com')
		expect(
			permissionService.classify({ scheme: 'https', host: 'avatars.githubusercontent.com', port: 443, source: 'main-https' })
		).toBe('prompt')
	})

	it('is in-memory only — never written to the persisted whitelist/blacklist (not user-deletable via the rules UI)', () => {
		permissionService.addSystemAllowedHost('lh3.googleusercontent.com')
		expect(permissionService.listWhitelist()).toHaveLength(0)
		expect(permissionService.listBlacklist()).toHaveLength(0)
		expect(permissionService.listSystemAllowedHosts()).toContain('lh3.googleusercontent.com')
	})

	it('ignores a blank host and is idempotent', () => {
		permissionService.addSystemAllowedHost('   ')
		permissionService.addSystemAllowedHost('')
		expect(permissionService.listSystemAllowedHosts()).toHaveLength(0)
		permissionService.addSystemAllowedHost('cdn.example')
		permissionService.addSystemAllowedHost('cdn.example')
		expect(permissionService.listSystemAllowedHosts()).toEqual(['cdn.example'])
	})
})

describe('PermissionService — declared outbound endpoints (the app\'s own traffic)', () => {
	it('reports an allowlist-backed endpoint as active only while its host is registered', () => {
		permissionService.declareSystemEndpoint({
			id: 'telemetry',
			host: 'eu.i.example.com',
			purposeKey: 'purpose.telemetry',
			consentGate: 'telemetry',
			exemption: 'system-allowlist'
		})
		expect(permissionService.listSystemEndpoints()[0]).toMatchObject({ id: 'telemetry', active: false })

		permissionService.addSystemAllowedHost('eu.i.example.com')
		expect(permissionService.listSystemEndpoints()[0]).toMatchObject({ active: true })

		permissionService.removeSystemAllowedHost('eu.i.example.com')
		expect(permissionService.listSystemEndpoints()[0]).toMatchObject({ active: false })
	})

	it('keeps a refused endpoint VISIBLE rather than hiding it', () => {
		permissionService.declareSystemEndpoint({
			id: 'crash',
			host: 'errors.example.com',
			purposeKey: 'purpose.crash',
			consentGate: 'crash',
			exemption: 'system-allowlist'
		})
		const rows = permissionService.listSystemEndpoints()
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ host: 'errors.example.com', consentGate: 'crash', active: false })
	})

	it('reports a call-scoped bypass as active once its host is known — it never joins the allowlist', () => {
		permissionService.declareSystemEndpoint({
			id: 'backend',
			host: 'project.supabase.co',
			purposeKey: 'purpose.backend',
			consentGate: null,
			exemption: 'call-scoped-bypass'
		})
		expect(permissionService.listSystemEndpoints()[0]).toMatchObject({ active: true })
		expect(permissionService.listSystemAllowedHosts()).toEqual([])
	})

	it('treats an unresolved host as inactive whatever the mechanism', () => {
		permissionService.declareSystemEndpoint({
			id: 'avatar',
			host: null,
			purposeKey: 'purpose.avatar',
			consentGate: null,
			exemption: 'system-allowlist'
		})
		expect(permissionService.listSystemEndpoints()[0]).toMatchObject({ active: false })
	})

	it('upserts by id and normalises the host, so a re-declaration never duplicates a row', () => {
		const declare = (host: string): void => {
			permissionService.declareSystemEndpoint({
				id: 'avatar', host, purposeKey: 'purpose.avatar', consentGate: null, exemption: 'system-allowlist'
			})
		}
		declare('LH3.googleusercontent.com')
		declare('avatars.githubusercontent.com')
		const rows = permissionService.listSystemEndpoints()
		expect(rows).toHaveLength(1)
		expect(rows[0]?.host).toBe('avatars.githubusercontent.com')
	})

	it('lowercases a declared host so it matches the allowlist', () => {
		permissionService.declareSystemEndpoint({
			id: 'avatar', host: 'LH3.googleusercontent.com', purposeKey: 'p', consentGate: null, exemption: 'system-allowlist'
		})
		permissionService.addSystemAllowedHost('lh3.googleusercontent.com')
		expect(permissionService.listSystemEndpoints()[0]).toMatchObject({
			host: 'lh3.googleusercontent.com',
			active: true
		})
	})

	it('sorts rows by id for a stable panel order', () => {
		for (const id of ['telemetry', 'avatar', 'backend']) {
			permissionService.declareSystemEndpoint({
				id, host: `${id}.example.com`, purposeKey: 'p', consentGate: null, exemption: 'system-allowlist'
			})
		}
		expect(permissionService.listSystemEndpoints().map((e) => e.id)).toEqual(['avatar', 'backend', 'telemetry'])
	})

	it('gates a consent-declared host at the VERDICT, not just in the panel', () => {
		// The point of tying the exemption to consent: with consent off the host
		// is classified exactly like any unknown destination, so an SDK that kept
		// a queued event around and retried it is stopped by the firewall rather
		// than by the sender's good manners.
		const host = 'eu.i.example.com'
		permissionService.declareSystemEndpoint({
			id: 'telemetry', host, purposeKey: 'p', consentGate: 'telemetry', exemption: 'system-allowlist'
		})
		const origin = { scheme: 'https', host, port: 443, source: 'main-fetch' } as const

		expect(permissionService.classify(origin)).toBe('prompt')
		permissionService.addSystemAllowedHost(host)
		expect(permissionService.classify(origin)).toBe('allow')
		permissionService.removeSystemAllowedHost(host)
		expect(permissionService.classify(origin)).toBe('prompt')
	})

	it('never exempts a consent-declared host over plaintext http', () => {
		const host = 'eu.i.example.com'
		permissionService.addSystemAllowedHost(host)
		expect(permissionService.classify({ scheme: 'http', host, port: 80, source: 'main-http' })).toBe('prompt')
	})

	it('undeclares a row entirely', () => {
		permissionService.declareSystemEndpoint({
			id: 'gone', host: 'x.example.com', purposeKey: 'p', consentGate: null, exemption: 'system-allowlist'
		})
		permissionService.undeclareSystemEndpoint('gone')
		permissionService.undeclareSystemEndpoint('never-existed')
		expect(permissionService.listSystemEndpoints()).toEqual([])
	})
})

describe('PermissionService.check', () => {
	it('resolves allow synchronously when classify returns allow', async () => {
		permissionService.addToWhitelist({ scheme: 'https', host: 'fast.example', port: 443 })
		const verdict = await permissionService.check({
			scheme: 'https',
			host: 'fast.example',
			port: 443,
			source: 'main-https'
		})
		expect(verdict).toBe('allow')
	})

	it('resolves deny synchronously when classify returns deny', async () => {
		permissionService.addToBlacklist({ scheme: 'https', host: 'fast.example', port: 443 })
		const verdict = await permissionService.check({
			scheme: 'https',
			host: 'fast.example',
			port: 443,
			source: 'main-https'
		})
		expect(verdict).toBe('deny')
	})

	it('auto-denies when no BrowserWindow can show the prompt, without persisting to blacklist', async () => {
		const verdict = await permissionService.check({
			scheme: 'https',
			host: 'no-window.example',
			port: 443,
			source: 'main-https'
		})
		expect(verdict).toBe('deny')
		// The auto-deny path is a synthetic resolution (no user click =
		// no user signal), so it must NOT persist the origin to the
		// blacklist — otherwise the very first prompt of a session
		// silently builds a forever-rule when no window is mounted yet.
		expect(
			permissionService.listBlacklist().some((o) => o.host === 'no-window.example')
		).toBe(false)
	})
})

describe('PermissionService.classify — app-protocol scheme normalisation', () => {
	// detectWireProtocol refines outbound requests to graphql/grpc/soap/odata,
	// but project origins + whitelist entries are keyed by the http/https
	// TRANSPORT. classify() must normalise the app-protocol back to its
	// transport so a request to a project mock auto-allows instead of prompting.
	it('auto-allows a graphql-classified request against an http project origin', () => {
		permissionService.setProjectOrigins([{ scheme: 'http', host: 'localhost', port: 4111 }])
		expect(
			permissionService.classify({ scheme: 'graphql', host: 'localhost', port: 4111, source: 'main-http' })
		).toBe('allow')
	})

	it('auto-allows grpc / soap / odata classified requests against their http project origin', () => {
		permissionService.setProjectOrigins([
			{ scheme: 'http', host: 'localhost', port: 50152 },
			{ scheme: 'http', host: 'localhost', port: 8088 },
			{ scheme: 'http', host: 'localhost', port: 9000 }
		])
		expect(permissionService.classify({ scheme: 'grpc', host: 'localhost', port: 50152, source: 'main-http' })).toBe('allow')
		expect(permissionService.classify({ scheme: 'soap', host: 'localhost', port: 8088, source: 'main-http' })).toBe('allow')
		expect(permissionService.classify({ scheme: 'odata', host: 'localhost', port: 9000, source: 'main-http' })).toBe('allow')
	})

	it('does NOT downgrade: a graphql request still prompts against an https-only project origin', () => {
		// Normalising graphql→http must not let it match a stricter https entry.
		permissionService.setProjectOrigins([{ scheme: 'https', host: 'api.example.com', port: 443 }])
		expect(
			permissionService.classify({ scheme: 'graphql', host: 'api.example.com', port: 443, source: 'main-https' })
		).toBe('prompt')
	})

	it('leaves transport schemes (http/https/ws) untouched', () => {
		permissionService.setProjectOrigins([{ scheme: 'https', host: 'p.example', port: 443 }])
		expect(
			permissionService.classify({ scheme: 'https', host: 'p.example', port: 443, source: 'main-https' })
		).toBe('allow')
	})
})
