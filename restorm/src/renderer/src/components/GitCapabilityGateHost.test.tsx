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

import { GitCapabilityGateHost } from './GitCapabilityGateHost'

const PRO: AuthState = { signedIn: true, user: { email: 'a@b.com' }, plan: 'pro', capabilities: ['git.client'] }
const COMMUNITY: AuthState = { signedIn: false, user: null, plan: 'community', capabilities: [] }

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

describe('GitCapabilityGateHost', () => {
  it('isLocked reports false for a capability present in the entitlement', async () => {
    stubAccount(PRO)
    const captures: CapturedGate[] = []
    render(
      <GitCapabilityGateHost>
        {(gate) => { captures.push(gate); return null }}
      </GitCapabilityGateHost>
    )
    await act(async () => { await Promise.resolve() })
    expect(captures[captures.length - 1]?.isLocked('git.client')).toBe(false)
  })

  it('isLocked reports true for a capability NOT present (Community)', async () => {
    stubAccount(COMMUNITY)
    const captures: CapturedGate[] = []
    render(
      <GitCapabilityGateHost>
        {(gate) => { captures.push(gate); return null }}
      </GitCapabilityGateHost>
    )
    await act(async () => { await Promise.resolve() })
    expect(captures[captures.length - 1]?.isLocked('git.client')).toBe(true)
  })

  it('the gate reference refreshes (and re-evaluates isLocked) on an entitlement change', async () => {
    const account = stubAccount(COMMUNITY)
    const captures: CapturedGate[] = []
    render(
      <GitCapabilityGateHost>
        {(gate) => { captures.push(gate); return null }}
      </GitCapabilityGateHost>
    )
    await act(async () => { await Promise.resolve() })
    expect(captures[captures.length - 1]?.isLocked('git.client')).toBe(true)

    account.emit(PRO)
    expect(captures[captures.length - 1]?.isLocked('git.client')).toBe(false)
  })

  it('onSubscribe calls subscribeToPro()', async () => {
    stubAccount(COMMUNITY)
    const captures: CapturedGate[] = []
    render(
      <GitCapabilityGateHost>
        {(gate) => { captures.push(gate); return null }}
      </GitCapabilityGateHost>
    )
    await act(async () => { await Promise.resolve() })
    captures[captures.length - 1]?.onSubscribe()
    expect(subscribeToProMock).toHaveBeenCalledTimes(1)
  })
})
