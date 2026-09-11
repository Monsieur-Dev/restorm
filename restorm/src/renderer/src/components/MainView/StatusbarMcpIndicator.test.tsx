// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, waitFor, cleanup } from '@testing-library/react'
import type { AuthState } from '../../../../shared/auth/authState'

/** The channel-resolved pricing URL the runtime config hands the renderer. */
const TEST_PRICING_URL = 'https://test.restorm.example/pricing'

// Capture the props the wrapper hands to the generic ECUI indicator so we can
// assert the Pro-upsell wiring without rendering the real popover.
const lastProps: { current: Record<string, unknown> | null } = { current: null }
// The renderer barrel loads Monaco (needs document.queryCommandSupported, absent in jsdom).
// Import useAuthState from its source file directly; stub only StatusbarMcpIndicator.
vi.mock('electron-core-ui/renderer', async () => {
  const { useAuthState } = await import('../../../../../../electron-core-ui/src/renderer/hooks/useAuthState')
  return {
    useAuthState,
    StatusbarMcpIndicator: (props: Record<string, unknown>) => {
      lastProps.current = props
      return null
    },
    // The wrapper also imports these (used by the one-time invite toast); provide
    // inert stubs so the mocked barrel resolves them without loading Monaco.
    Button: () => null,
    toasterService: { push: vi.fn(() => ''), dismiss: vi.fn() }
  }
})
// The connect modal mounts the real ECUI Modal; these tests only exercise the
// upsell wiring, so stub it out.
vi.mock('../Modals/McpConnectModal', () => ({ McpConnectModal: () => null }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import { StatusbarMcpIndicator } from './StatusbarMcpIndicator'

const PRO: AuthState = { signedIn: true, user: { email: 'a@b.com' }, plan: 'pro', role: 'admin', capabilities: ['mcp.pro'] }
const COMMUNITY: AuthState = { signedIn: false, user: null, plan: 'community', role: 'member', capabilities: [] }

function stubEnv(state: AuthState): void {
  ;(window as unknown as { api: unknown }).api = {
    account: {
      getState: () => Promise.resolve(state),
      onStateChanged: () => vi.fn()
    }
  }
  ;(window as unknown as { restorm: unknown }).restorm = {
    runtime: {
      getConfig: () => Promise.resolve({ mcp: { enabled: true, port: 39000, sessionName: '', running: true }, pricingUrl: TEST_PRICING_URL })
    }
  }
}

afterEach(() => {
  cleanup()
  lastProps.current = null
  delete (window as { api?: unknown }).api
  delete (window as { restorm?: unknown }).restorm
})

describe('restorm StatusbarMcpIndicator — Pro upsell wiring', () => {
  it('passes the translated upsell to ECUI when the plan lacks mcp.pro (Community)', async () => {
    stubEnv(COMMUNITY)
    render(<StatusbarMcpIndicator />)
    await waitFor(() => {
      const upsell = lastProps.current?.['proUpsell'] as { note: string; linkLabel: string; onUpgrade: () => void } | undefined
      expect(upsell).toBeTruthy()
      expect(upsell?.note).toBe('mcp.proUpsell.note')
      expect(upsell?.linkLabel).toBe('mcp.proUpsell.link')
    })
  })

  it('opens the pricing page in the system browser via onUpgrade', async () => {
    stubEnv(COMMUNITY)
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    render(<StatusbarMcpIndicator />)
    await waitFor(() => { expect(lastProps.current?.['proUpsell']).toBeTruthy() })
    const upsell = lastProps.current?.['proUpsell'] as { onUpgrade: () => void }
    upsell.onUpgrade()
    expect(openSpy).toHaveBeenCalledWith(TEST_PRICING_URL, '_blank', 'noopener,noreferrer')
    openSpy.mockRestore()
  })

  it('does NOT pass an upsell when the plan grants mcp.pro', async () => {
    stubEnv(PRO)
    render(<StatusbarMcpIndicator />)
    // Wait for the config + capability effects to settle, then assert no upsell.
    await waitFor(() => { expect(lastProps.current).not.toBeNull() })
    await waitFor(() => {
      expect(lastProps.current?.['proUpsell']).toBeUndefined()
    })
  })
})
