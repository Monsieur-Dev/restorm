// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { AccountButton } from './AccountButton'
import type { AuthState } from '../../../shared/auth/authState'

const SIGNED_OUT: AuthState = { signedIn: false, user: null, plan: 'community', capabilities: [] }
const COMMUNITY: AuthState = { signedIn: true, user: { email: 'a@b.com' }, plan: 'community', capabilities: [] }
const PRO: AuthState = { signedIn: true, user: { email: 'a@b.com' }, plan: 'pro', capabilities: [] }

const account = {
  login: vi.fn(() => Promise.resolve(SIGNED_OUT)),
  logout: vi.fn(() => Promise.resolve(SIGNED_OUT)),
  getState: vi.fn(() => Promise.resolve(SIGNED_OUT)),
  onStateChanged: vi.fn(() => () => undefined),
  subscribe: vi.fn(() => Promise.resolve({ status: 'opened' as const })),
  manageSubscription: vi.fn(() => Promise.resolve({ status: 'opened' as const }))
}

function mockAccount(state: AuthState): void {
  account.getState.mockResolvedValue(state)
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = { account }
}

/** Render, wait for the on-mount getState to settle, then open the dropdown. */
async function openMenu(state: AuthState): Promise<void> {
  mockAccount(state)
  render(<AccountButton />)
  await waitFor(() => { expect(account.getState).toHaveBeenCalled(); })
  fireEvent.click(screen.getByTestId('titlebar-account-button'))
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => { cleanup() })

describe('AccountButton — subscription menu items', () => {
  it('signed out: only the sign-in item, no subscription affordance', async () => {
    await openMenu(SIGNED_OUT)
    expect(screen.getByTestId('account-menu-sign-in')).not.toBeNull()
    expect(screen.queryByTestId('account-menu-upgrade')).toBeNull()
    expect(screen.queryByTestId('account-menu-manage-subscription')).toBeNull()
  })

  it('signed in (community): shows the « Passer à Pro » upsell, not the manage item', async () => {
    await openMenu(COMMUNITY)
    await waitFor(() => { expect(screen.queryByTestId('account-menu-upgrade')).not.toBeNull(); })
    expect(screen.queryByTestId('account-menu-manage-subscription')).toBeNull()
    expect(screen.getByTestId('account-menu-sign-out')).not.toBeNull()
  })

  it('signed in (pro): shows « Gérer mon abonnement », not the upsell', async () => {
    await openMenu(PRO)
    await waitFor(() => { expect(screen.queryByTestId('account-menu-manage-subscription')).not.toBeNull(); })
    expect(screen.queryByTestId('account-menu-upgrade')).toBeNull()
  })

  it('clicking « Gérer mon abonnement » opens the customer portal', async () => {
    await openMenu(PRO)
    const item = await screen.findByTestId('account-menu-manage-subscription')
    fireEvent.click(item)
    await waitFor(() => { expect(account.manageSubscription).toHaveBeenCalledTimes(1); })
    expect(account.subscribe).not.toHaveBeenCalled()
  })

  it('clicking « Passer à Pro » starts checkout', async () => {
    await openMenu(COMMUNITY)
    const item = await screen.findByTestId('account-menu-upgrade')
    fireEvent.click(item)
    await waitFor(() => { expect(account.subscribe).toHaveBeenCalledTimes(1); })
    expect(account.manageSubscription).not.toHaveBeenCalled()
  })
})
