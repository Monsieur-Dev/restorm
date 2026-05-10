import { describe, it, expect, vi, beforeEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'

vi.mock('electron', () => {
	const path = mkdtempSync(join(tmpdir(), 'restorm-fw-test-'))
	return {
		app: {
			getPath: (): string => path
		},
		BrowserWindow: {
			getAllWindows: (): never[] => []
		}
	}
})

vi.mock('electron-core-ui', () => ({
	logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }
}))

import { permissionService } from './PermissionService'

beforeEach(() => {
	for (const o of permissionService.listWhitelist()) permissionService.removeFromWhitelist(o)
	for (const o of permissionService.listBlacklist()) permissionService.removeFromBlacklist(o)
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

	it('auto-denies when no BrowserWindow can show the prompt', async () => {
		const verdict = await permissionService.check({
			scheme: 'https',
			host: 'no-window.example',
			port: 443,
			source: 'main-https'
		})
		expect(verdict).toBe('deny')
		// The auto-deny path also persists the origin to the blacklist.
		expect(
			permissionService.listBlacklist().some((o) => o.host === 'no-window.example')
		).toBe(true)
	})
})
