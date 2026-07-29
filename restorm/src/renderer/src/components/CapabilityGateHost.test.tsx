// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import type { AuthState } from '../../../shared/auth/authState'

// Same Monaco-avoidance workaround as `useCapability.test.tsx`: import
// `useAuthState` straight from its source rather than the full
// `electron-core-ui/renderer` barrel.
vi.mock('electron-core-ui/renderer', async () => {
  const { useAuthState } = await import('../../../../../electron-core-ui/src/renderer/hooks/useAuthState')
  return { useAuthState }
})

const { subscribeToProMock } = vi.hoisted(() => ({ subscribeToProMock: vi.fn() }))
vi.mock('../services/subscribeToPro', () => ({ subscribeToPro: subscribeToProMock }))

import { CapabilityGateHost } from './CapabilityGateHost'
import { CRASH_OPT_OUT_CAPABILITY } from '../../../shared/auth/planCapabilities'

const PRO: AuthState = { signedIn: true, user: { email: 'a@b.com' }, plan: 'pro', role: 'admin', capabilities: ['git.client'] }
const COMMUNITY: AuthState = { signedIn: false, user: null, plan: 'community', role: 'member', capabilities: [] }

function stubAccount(initial: AuthState): { emit: (s: AuthState) => void } {
  let listener: ((s: AuthState) => void) | null = null
  ;(window as unknown as { api: unknown }).api = {
    account: {
      getState: () => Promise.resolve(initial),
      onStateChanged: (cb: (s: AuthState) => void) => { listener = cb; return vi.fn() }
    }
  }
  return { emit: (s) => { act(() => { listener?.(s) }) } }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  delete (window as { api?: unknown }).api
})

interface CapturedGate {
  isLocked: (capability: string) => boolean
  onSubscribe: () => void
}

describe('CapabilityGateHost', () => {
  it('isLocked reports false for a capability present in the entitlement', async () => {
    stubAccount(PRO)
    const captures: CapturedGate[] = []
    render(
      <CapabilityGateHost>
        {(gate) => { captures.push(gate); return null }}
      </CapabilityGateHost>
    )
    await act(async () => { await Promise.resolve() })
    expect(captures[captures.length - 1]?.isLocked('git.client')).toBe(false)
  })

  it('isLocked reports true for a capability NOT present (Community)', async () => {
    stubAccount(COMMUNITY)
    const captures: CapturedGate[] = []
    render(
      <CapabilityGateHost>
        {(gate) => { captures.push(gate); return null }}
      </CapabilityGateHost>
    )
    await act(async () => { await Promise.resolve() })
    expect(captures[captures.length - 1]?.isLocked('git.client')).toBe(true)
  })

  it('the gate reference refreshes (and re-evaluates isLocked) on an entitlement change', async () => {
    const account = stubAccount(COMMUNITY)
    const captures: CapturedGate[] = []
    render(
      <CapabilityGateHost>
        {(gate) => { captures.push(gate); return null }}
      </CapabilityGateHost>
    )
    await act(async () => { await Promise.resolve() })
    expect(captures[captures.length - 1]?.isLocked('git.client')).toBe(true)

    account.emit(PRO)
    expect(captures[captures.length - 1]?.isLocked('git.client')).toBe(false)
  })

  it('locks the crash opt-out on Community even though no capability is minted for it', async () => {
    // Community accounts cannot turn crash reporting off; the control renders
    // greyed with an upsell rather than disappearing.
    stubAccount(COMMUNITY)
    const captures: CapturedGate[] = []
    render(
      <CapabilityGateHost>
        {(gate) => { captures.push(gate); return null }}
      </CapabilityGateHost>
    )
    await act(async () => { await Promise.resolve() })
    expect(captures[captures.length - 1]?.isLocked(CRASH_OPT_OUT_CAPABILITY)).toBe(true)
  })

  it('unlocks the crash opt-out on a paid plan, which the capability list alone would not', async () => {
    // `crash.optOut` is absent from PRO.capabilities on purpose: the backend
    // never mints it, so resolving it through `hasCapability` would lock a
    // paying user out of an opt-out they are entitled to.
    stubAccount(PRO)
    const captures: CapturedGate[] = []
    render(
      <CapabilityGateHost>
        {(gate) => { captures.push(gate); return null }}
      </CapabilityGateHost>
    )
    await act(async () => { await Promise.resolve() })
    expect(PRO.capabilities).not.toContain(CRASH_OPT_OUT_CAPABILITY)
    expect(captures[captures.length - 1]?.isLocked(CRASH_OPT_OUT_CAPABILITY)).toBe(false)
  })

  it('re-evaluates the crash opt-out lock on a plan transition', async () => {
    const account = stubAccount(COMMUNITY)
    const captures: CapturedGate[] = []
    render(
      <CapabilityGateHost>
        {(gate) => { captures.push(gate); return null }}
      </CapabilityGateHost>
    )
    await act(async () => { await Promise.resolve() })
    expect(captures[captures.length - 1]?.isLocked(CRASH_OPT_OUT_CAPABILITY)).toBe(true)
    account.emit(PRO)
    expect(captures[captures.length - 1]?.isLocked(CRASH_OPT_OUT_CAPABILITY)).toBe(false)
  })

  it('onSubscribe calls subscribeToPro()', async () => {
    stubAccount(COMMUNITY)
    const captures: CapturedGate[] = []
    render(
      <CapabilityGateHost>
        {(gate) => { captures.push(gate); return null }}
      </CapabilityGateHost>
    )
    await act(async () => { await Promise.resolve() })
    captures[captures.length - 1]?.onSubscribe()
    expect(subscribeToProMock).toHaveBeenCalledTimes(1)
  })
})
