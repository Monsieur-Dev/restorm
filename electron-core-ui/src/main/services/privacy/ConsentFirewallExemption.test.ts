// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { ConsentFirewallExemption, type ConsentGatedEndpoint } from './ConsentFirewallExemption'
import type { SystemHostAllowlist } from '../auth/avatarFirewallExemption'

function makeFakeAllowlist(): SystemHostAllowlist & { hosts: Set<string>; added: string[]; removed: string[] } {
	const hosts = new Set<string>()
	const added: string[] = []
	const removed: string[] = []
	return {
		hosts,
		added,
		removed,
		addSystemAllowedHost: (h) => { added.push(h); hosts.add(h) },
		removeSystemAllowedHost: (h) => { removed.push(h); hosts.delete(h) }
	}
}

const ENDPOINTS: ConsentGatedEndpoint[] = [
	{ host: 'errors.example.com', consentGate: 'crash' },
	{ host: 'eu.i.example.com', consentGate: 'telemetry' }
]

describe('ConsentFirewallExemption', () => {
	it('exempts nothing while every gate is refused', () => {
		const allowlist = makeFakeAllowlist()
		const exemption = new ConsentFirewallExemption(allowlist, ENDPOINTS, () => false)
		expect(exemption.sync()).toEqual([])
		expect(allowlist.added).toEqual([])
	})

	it('exempts only the hosts whose gate is granted', () => {
		const allowlist = makeFakeAllowlist()
		const exemption = new ConsentFirewallExemption(allowlist, ENDPOINTS, (g) => g === 'telemetry')
		expect(exemption.sync()).toEqual(['eu.i.example.com'])
		expect(Array.from(allowlist.hosts)).toEqual(['eu.i.example.com'])
	})

	it('drops the exemption the moment consent is revoked', () => {
		const allowlist = makeFakeAllowlist()
		let granted = true
		const exemption = new ConsentFirewallExemption(allowlist, ENDPOINTS, () => granted)
		exemption.sync()
		expect(allowlist.hosts.size).toBe(2)
		granted = false
		expect(exemption.sync()).toEqual([])
		expect(allowlist.hosts.size).toBe(0)
		expect(allowlist.removed.sort()).toEqual(['errors.example.com', 'eu.i.example.com'])
	})

	it('is idempotent — re-syncing an unchanged state touches the allowlist zero times', () => {
		const allowlist = makeFakeAllowlist()
		const exemption = new ConsentFirewallExemption(allowlist, ENDPOINTS, () => true)
		exemption.sync()
		const addedAfterFirst = allowlist.added.length
		exemption.sync()
		exemption.sync()
		expect(allowlist.added).toHaveLength(addedAfterFirst)
		expect(allowlist.removed).toEqual([])
	})

	it('never exempts an unresolved host', () => {
		const allowlist = makeFakeAllowlist()
		const exemption = new ConsentFirewallExemption(
			allowlist,
			[{ host: null, consentGate: 'crash' }, { host: '', consentGate: 'telemetry' }],
			() => true
		)
		expect(exemption.sync()).toEqual([])
		expect(allowlist.added).toEqual([])
	})

	it('registers hosts lower-cased, matching how the allowlist compares them', () => {
		const allowlist = makeFakeAllowlist()
		const exemption = new ConsentFirewallExemption(
			allowlist,
			[{ host: 'Errors.Example.COM', consentGate: 'crash' }],
			() => true
		)
		expect(exemption.sync()).toEqual(['errors.example.com'])
	})

	it('clear() releases every exemption it holds and nothing else', () => {
		const allowlist = makeFakeAllowlist()
		allowlist.addSystemAllowedHost('cdn.someone-else.com')
		const exemption = new ConsentFirewallExemption(allowlist, ENDPOINTS, () => true)
		exemption.sync()
		exemption.clear()
		expect(Array.from(allowlist.hosts)).toEqual(['cdn.someone-else.com'])
	})

	it('clear() is idempotent', () => {
		const allowlist = makeFakeAllowlist()
		const exemption = new ConsentFirewallExemption(allowlist, ENDPOINTS, () => true)
		exemption.sync()
		exemption.clear()
		exemption.clear()
		expect(allowlist.removed).toHaveLength(2)
	})
})
