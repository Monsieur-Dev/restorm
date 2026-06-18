// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import {
  configureFirewall,
  resetFirewallConfig,
  isFirewallE2EBypass,
  getWorkerBootstrapPrefix,
  isInternalEndpoint,
  isInternalRequest
} from './firewallConfig'

describe('firewallConfig', () => {
  afterEach(() => {
    resetFirewallConfig()
  })

  describe('defaults (no host config injected)', () => {
    it('exposes safe, app-agnostic defaults', () => {
      expect(isFirewallE2EBypass()).toBe(false)
      expect(getWorkerBootstrapPrefix()).toBe('ecui-firewall-bootstrap')
    })

    it('treats no URL as an internal endpoint', () => {
      expect(isInternalEndpoint('http://localhost:4000/graphql')).toBe(false)
    })

    it('treats no request as internal', () => {
      expect(isInternalRequest([{ headers: { 'x-anything': '1' } }])).toBe(false)
    })
  })

  describe('configureFirewall merges over the current config', () => {
    it('applies the e2e bypass and worker prefix', () => {
      configureFirewall({ e2eBypass: true, workerBootstrapPrefix: 'app-firewall' })
      expect(isFirewallE2EBypass()).toBe(true)
      expect(getWorkerBootstrapPrefix()).toBe('app-firewall')
    })

    it('ignores an empty worker prefix', () => {
      configureFirewall({ workerBootstrapPrefix: '' })
      expect(getWorkerBootstrapPrefix()).toBe('ecui-firewall-bootstrap')
    })

    it('clears a previously-set internalEndpointProvider when passed null', () => {
      configureFirewall({ internalEndpointProvider: () => 'http://localhost:4000/graphql' })
      expect(isInternalEndpoint('http://localhost:4000/graphql')).toBe(true)
      configureFirewall({ internalEndpointProvider: null })
      expect(isInternalEndpoint('http://localhost:4000/graphql')).toBe(false)
    })
  })

  describe('isInternalEndpoint (injected provider)', () => {
    it('matches the provider host + path and its sub-paths', () => {
      configureFirewall({ internalEndpointProvider: () => 'http://localhost:4000/graphql' })
      expect(isInternalEndpoint('http://localhost:4000/graphql')).toBe(true)
      expect(isInternalEndpoint('http://localhost:4000/graphql/subscriptions')).toBe(true)
      expect(isInternalEndpoint('http://localhost:4000/other')).toBe(false)
      expect(isInternalEndpoint('http://localhost:5000/graphql')).toBe(false)
    })

    it('re-reads the provider each call so a changing port is picked up', () => {
      let port = 4000
      configureFirewall({ internalEndpointProvider: () => `http://localhost:${port}/graphql` })
      expect(isInternalEndpoint('http://localhost:4000/graphql')).toBe(true)
      port = 4100
      expect(isInternalEndpoint('http://localhost:4000/graphql')).toBe(false)
      expect(isInternalEndpoint('http://localhost:4100/graphql')).toBe(true)
    })

    it('returns false on an unparseable URL instead of throwing', () => {
      configureFirewall({ internalEndpointProvider: () => 'http://localhost:4000/graphql' })
      expect(isInternalEndpoint('not a url')).toBe(false)
    })
  })

  describe('isInternalRequest (injected predicate)', () => {
    it('exempts a request the predicate flags as internal', () => {
      configureFirewall({
        internalRequestPredicate: (args) =>
          args.some(
            (a) => typeof a === 'object' && a !== null && 'headers' in a &&
              Boolean((a as { headers?: Record<string, unknown> }).headers?.['x-mcp-forwarded'])
          )
      })
      expect(isInternalRequest([{ headers: { 'x-mcp-forwarded': '1' } }])).toBe(true)
      expect(isInternalRequest([{ headers: { 'content-type': 'application/json' } }])).toBe(false)
    })

    it('treats a throwing predicate as "not internal" rather than crashing', () => {
      configureFirewall({
        internalRequestPredicate: () => {
          throw new Error('host hook blew up')
        }
      })
      expect(isInternalRequest([{}])).toBe(false)
    })

    it('clears the predicate when passed null', () => {
      configureFirewall({ internalRequestPredicate: () => true })
      expect(isInternalRequest([{}])).toBe(true)
      configureFirewall({ internalRequestPredicate: null })
      expect(isInternalRequest([{}])).toBe(false)
    })
  })
})
