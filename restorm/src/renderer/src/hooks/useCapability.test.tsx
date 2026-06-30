// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'
import { useCapability } from './useCapability'
import type { AuthState } from '../../../shared/auth/authState'

// Import the hook directly from its source file rather than the ECUI renderer barrel.
// The barrel transitively loads Monaco Editor, which calls document.queryCommandSupported
// — an API jsdom doesn't implement.  useAuthState itself only needs React + window.api.
vi.mock('electron-core-ui/renderer', async () => {
  const { useAuthState } = await import('../../../../../electron-core-ui/src/renderer/hooks/useAuthState')
  return { useAuthState }
})

const PRO: AuthState = {
  signedIn: true,
  user: { email: 'a@b.com' },
  plan: 'pro',
  capabilities: ['scenario.stepDebug']
}
const COMMUNITY: AuthState = { signedIn: false, user: null, plan: 'community', capabilities: [] }

afterEach(() => {
  cleanup()
  delete (window as { api?: unknown }).api
})

function stubAccount(initial: AuthState): { emit: (s: AuthState) => void; unsubscribe: ReturnType<typeof vi.fn> } {
  let listener: ((s: AuthState) => void) | null = null
  const unsubscribe = vi.fn()
  ;(window as unknown as { api: unknown }).api = {
    account: {
      getState: () => Promise.resolve(initial),
      onStateChanged: (cb: (s: AuthState) => void) => { listener = cb; return unsubscribe }
    }
  }
  return { emit: (s) => { act(() => { listener?.(s) }) }, unsubscribe }
}

describe('useCapability', () => {
  it('reads the initial entitlement and reflects a granted capability', async () => {
    stubAccount(PRO)
    const { result } = renderHook(() => useCapability('scenario.stepDebug'))
    // Defaults to false (signed-out snapshot) before getState resolves.
    expect(result.current).toBe(false)
    await waitFor(() => { expect(result.current).toBe(true) })
  })

  it('re-renders on a state change (login → logout drops the capability)', async () => {
    const account = stubAccount(PRO)
    const { result } = renderHook(() => useCapability('scenario.stepDebug'))
    await waitFor(() => { expect(result.current).toBe(true) })
    account.emit(COMMUNITY)
    expect(result.current).toBe(false)
  })

  it('detaches the listener on unmount', async () => {
    const account = stubAccount(PRO)
    const { unmount, result } = renderHook(() => useCapability('scenario.stepDebug'))
    await waitFor(() => { expect(result.current).toBe(true) })
    unmount()
    expect(account.unsubscribe).toHaveBeenCalledTimes(1)
  })
})
