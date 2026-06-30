// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { AccountButton } from './AccountButton'
import type { AuthState } from '../../../shared/auth/authState'

const SIGNED_OUT: AuthState = { signedIn: false, user: null, plan: 'community', capabilities: [] }
const COMMUNITY: AuthState = { signedIn: true, user: { email: 'a@b.com' }, plan: 'community', capabilities: [] }
const PRO: AuthState = { signedIn: true, user: { email: 'a@b.com' }, plan: 'pro', capabilities: [] }

const DASHBOARD = 'https://my.restorm.app'

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

/** Render with the dashboard URL injected, wait for the on-mount getState to
 * settle, then click the avatar to open the popover card. */
async function openCard(state: AuthState): Promise<void> {
  mockAccount(state)
  render(<AccountButton dashboardUrl={DASHBOARD} />)
  await waitFor(() => { expect(account.getState).toHaveBeenCalled() })
  fireEvent.click(screen.getByTestId('titlebar-account-button'))
  await screen.findByTestId('account-card')
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { open: unknown }).open = vi.fn()
})
afterEach(() => { cleanup() })

describe('AccountButton — popover card', () => {
  it('does not render the card until the avatar is clicked', () => {
    mockAccount(PRO)
    render(<AccountButton dashboardUrl={DASHBOARD} />)
    expect(screen.queryByTestId('account-card')).toBeNull()
  })

  it('signed out: minimal card — only sign-in (no badge, upsell, dashboard, manage)', async () => {
    await openCard(SIGNED_OUT)
    expect(screen.getByTestId('account-card-sign-in')).not.toBeNull()
    expect(screen.queryByTestId('account-card-plan-badge')).toBeNull()
    expect(screen.queryByTestId('account-card-upgrade')).toBeNull()
    expect(screen.queryByTestId('account-card-dashboard')).toBeNull()
    expect(screen.queryByTestId('account-card-manage-subscription')).toBeNull()
  })

  it('signed in (community): Community badge + dashboard + upgrade + sign-out', async () => {
    await openCard(COMMUNITY)
    expect(screen.getByTestId('account-card-plan-badge').textContent).toBe('Community')
    expect(screen.getByTestId('account-card-dashboard')).not.toBeNull()
    expect(screen.getByTestId('account-card-upgrade')).not.toBeNull()
    expect(screen.getByTestId('account-card-sign-out')).not.toBeNull()
    expect(screen.queryByTestId('account-card-manage-subscription')).toBeNull()
  })

  it('signed in (pro): Pro badge + manage subscription, no upgrade', async () => {
    await openCard(PRO)
    expect(screen.getByTestId('account-card-plan-badge').textContent).toBe('Pro')
    expect(screen.getByTestId('account-card-manage-subscription')).not.toBeNull()
    expect(screen.queryByTestId('account-card-upgrade')).toBeNull()
  })

  it('dashboard link opens the injected URL in the system browser', async () => {
    await openCard(PRO)
    fireEvent.click(screen.getByTestId('account-card-dashboard'))
    expect(window.open).toHaveBeenCalledWith(DASHBOARD, '_blank', 'noopener,noreferrer')
  })

  it('manage subscription opens the customer portal', async () => {
    await openCard(PRO)
    fireEvent.click(screen.getByTestId('account-card-manage-subscription'))
    await waitFor(() => { expect(account.manageSubscription).toHaveBeenCalledTimes(1) })
  })
})

describe('AccountButton — sign-out confirmation', () => {
  it('sign-out asks for confirmation; cancel does NOT log out', async () => {
    await openCard(PRO)
    fireEvent.click(screen.getByTestId('account-card-sign-out'))
    await screen.findByTestId('account-sign-out-confirm-message')
    fireEvent.click(screen.getByTestId('account-sign-out-confirm-cancel'))
    expect(account.logout).not.toHaveBeenCalled()
  })

  it('confirming the dialog logs out', async () => {
    await openCard(PRO)
    fireEvent.click(screen.getByTestId('account-card-sign-out'))
    const confirm = await screen.findByTestId('account-sign-out-confirm-yes')
    fireEvent.click(confirm)
    await waitFor(() => { expect(account.logout).toHaveBeenCalledTimes(1) })
  })
})
