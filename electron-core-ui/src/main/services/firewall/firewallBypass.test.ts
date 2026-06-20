// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { withFirewallBypass, withFirewallBypassSync, isFirewallBypassed } from './firewallBypass'

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

  describe('withFirewallBypassSync', () => {
    it('bypasses inside the synchronous body, returns its value, and unwinds after', () => {
      expect(isFirewallBypassed()).toBe(false)
      const result = withFirewallBypassSync(() => {
        expect(isFirewallBypassed()).toBe(true)
        return 42
      })
      expect(result).toBe(42)
      expect(isFirewallBypassed()).toBe(false)
    })

    it('unwinds even when the body throws', () => {
      expect(() => withFirewallBypassSync(() => { throw new Error('boom') })).toThrow('boom')
      expect(isFirewallBypassed()).toBe(false)
    })

    it('propagates the bypass into an async resource created during the sync body', async () => {
      // This is the property the protocol-connect wrap relies on: a client
      // that defers its socket connect to a timer/microtask SCHEDULED during
      // the synchronous `new WebSocket()` / `io()` / `mqtt.connect()` call
      // still runs that connect inside the bypassed context (AsyncLocalStorage
      // carries the store into resources created within `run`).
      let observed: boolean | undefined
      const settled = new Promise<void>((resolve) => {
        withFirewallBypassSync(() => {
          setTimeout(() => { observed = isFirewallBypassed(); resolve() }, 0)
        })
      })
      await settled
      expect(observed).toBe(true)
    })

    it('does NOT leak the bypass to a task rooted outside the sync body', async () => {
      // A timer scheduled BEFORE entering the bypass belongs to its own
      // context — the sync bypass must not retroactively capture it.
      let observed: boolean | undefined
      const outsider = new Promise<void>((resolve) => {
        setTimeout(() => { observed = isFirewallBypassed(); resolve() }, 0)
      })
      withFirewallBypassSync(() => undefined)
      await outsider
      expect(observed).toBe(false)
    })
  })
})
