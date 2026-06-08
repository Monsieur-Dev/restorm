// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { withFirewallBypass, isFirewallBypassed } from './firewallBypass'

describe('firewallBypass', () => {
  it('is not bypassed by default', () => {
    expect(isFirewallBypassed()).toBe(false)
  })

  it('reports bypassed inside the scope and not after', async () => {
    expect(isFirewallBypassed()).toBe(false)
    await withFirewallBypass(() => {
      expect(isFirewallBypassed()).toBe(true)
      return Promise.resolve()
    })
    expect(isFirewallBypassed()).toBe(false)
  })

  it('keeps the bypass across awaits within the same call-chain', async () => {
    await withFirewallBypass(async () => {
      expect(isFirewallBypassed()).toBe(true)
      await new Promise((r) => setTimeout(r, 5))
      // The async continuation still belongs to the bypassed context.
      expect(isFirewallBypassed()).toBe(true)
    })
  })

  it('unwinds the scope even when fn rejects', async () => {
    await expect(withFirewallBypass(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    expect(isFirewallBypassed()).toBe(false)
  })

  it('nests: an inner scope inherits, the outer stays bypassed after the inner settles', async () => {
    await withFirewallBypass(async () => {
      expect(isFirewallBypassed()).toBe(true)
      await withFirewallBypass(() => {
        expect(isFirewallBypassed()).toBe(true)
        return Promise.resolve()
      })
      expect(isFirewallBypassed()).toBe(true)
    })
    expect(isFirewallBypassed()).toBe(false)
  })

  // The security-critical property: the bypass must NOT leak to unrelated
  // traffic that merely overlaps it on the event loop. A concurrent async
  // operation started OUTSIDE the bypass must observe `false` the whole time,
  // even while a long-lived bypass is open — otherwise a sandbox `fetch`
  // running alongside an in-flight httpRequest node would skip the firewall.
  it('does NOT leak the bypass to a concurrent, separately-rooted async task', async () => {
    let bypassOpen: () => void = () => undefined
    const bypassHeld = new Promise<void>((resolve) => { bypassOpen = resolve })

    // Long-lived bypass: stays open until we resolve `bypassHeld`.
    const held = withFirewallBypass(async () => {
      expect(isFirewallBypassed()).toBe(true)
      await bypassHeld
      expect(isFirewallBypassed()).toBe(true)
    })

    // A task rooted OUTSIDE the bypass, observed while the bypass is open.
    const observed: boolean[] = []
    const outsider = (async () => {
      await new Promise((r) => setTimeout(r, 5))
      observed.push(isFirewallBypassed()) // bypass still open here
      await new Promise((r) => setTimeout(r, 5))
      observed.push(isFirewallBypassed())
    })()

    await outsider
    bypassOpen()
    await held
    expect(observed).toEqual([false, false])
  })
})
