// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import type { AuthState } from '../../../../../shared/auth/authState'

// react-i18next is not initialized in unit tests; `useTranslation` echoes the
// key. We assert on stable `data-testid`s, not on translated label text.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key })
}))

// ECUI resolves to its built dist in vitest, whose CSS side-imports don't
// resolve. Stub the module with minimal DOM components preserving the props
// AccountButton relies on (icon element / codicon, onClick, data-testid).
interface MenuItemLike { id?: string; onClick?: () => void; 'data-testid'?: string }
vi.mock('electron-core-ui/renderer', () => {
  const Button = (props: {
    icon?: ReactNode
    onClick?: () => void
    'data-testid'?: string
    options?: { ariaLabel?: string }
  }): ReactNode =>
    createElement(
      'button',
      {
        type: 'button',
        ...(props['data-testid'] ? { 'data-testid': props['data-testid'] } : {}),
        ...(props.options?.ariaLabel ? { 'aria-label': props.options.ariaLabel } : {}),
        ...(props.onClick ? { onClick: props.onClick } : {})
      },
      typeof props.icon === 'string'
        ? createElement('span', { className: `codicon codicon-${props.icon}`, 'data-testid': 'account-codicon' })
        : props.icon
    )
  const Avatar = (props: { name?: string; imageUrl?: string; 'data-testid'?: string }): ReactNode =>
    createElement(
      'span',
      { ...(props['data-testid'] ? { 'data-testid': props['data-testid'] } : {}), 'data-image': props.imageUrl ?? '' },
      props.name
    )
  const ContextMenu = (props: { visible: boolean; items: MenuItemLike[]; 'data-testid'?: string }): ReactNode => {
    if (!props.visible) return null
    return createElement(
      'ul',
      { ...(props['data-testid'] ? { 'data-testid': props['data-testid'] } : {}) },
      props.items.map((item) =>
        createElement('li', {
          key: item.id,
          role: 'menuitem',
          ...(item['data-testid'] ? { 'data-testid': item['data-testid'] } : {}),
          ...(item.onClick ? { onClick: () => { item.onClick?.() } } : {})
        })
      )
    )
  }
  const Tooltip = (): ReactNode => null
  return { Button, Avatar, ContextMenu, Tooltip }
})

import { AccountButton } from './AccountButton'

const SIGNED_OUT: AuthState = { signedIn: false, user: null, plan: 'community', capabilities: [] }
const SIGNED_IN: AuthState = {
  signedIn: true,
  user: { email: 'jane.doe@acme.io' },
  plan: 'pro',
  capabilities: []
}

let login: ReturnType<typeof vi.fn>
let logout: ReturnType<typeof vi.fn>
let getState: ReturnType<typeof vi.fn>
let stateCb: ((state: AuthState) => void) | null

beforeEach(() => {
  login = vi.fn().mockResolvedValue(SIGNED_IN)
  logout = vi.fn().mockResolvedValue(SIGNED_OUT)
  getState = vi.fn().mockResolvedValue(SIGNED_OUT)
  stateCb = null
  ;(window as unknown as { api: unknown }).api = {
    account: {
      login,
      logout,
      getState,
      onStateChanged: (cb: (state: AuthState) => void) => {
        stateCb = cb
        return () => { stateCb = null }
      }
    }
  }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AccountButton', () => {
  it('renders the account codicon when signed out and opens a sign-in dropdown', async () => {
    const { getByTestId, queryByTestId } = render(<AccountButton />)
    await waitFor(() => { expect(getState).toHaveBeenCalled() })

    expect(getByTestId('account-codicon').className).toContain('codicon-account')
    // Closed dropdown initially.
    expect(queryByTestId('account-context-menu')).toBeNull()

    fireEvent.click(getByTestId('titlebar-account-button'))
    expect(getByTestId('account-menu-sign-in')).not.toBeNull()

    fireEvent.click(getByTestId('account-menu-sign-in'))
    expect(login).toHaveBeenCalledTimes(1)
    expect(logout).not.toHaveBeenCalled()
  })

  it('shows the avatar + a sign-out dropdown once signed in (live via onStateChanged)', async () => {
    const { getByTestId, queryByTestId } = render(<AccountButton />)
    await waitFor(() => { expect(getState).toHaveBeenCalled() })

    // Push a live login transition.
    act(() => { stateCb?.(SIGNED_IN) })

    const avatar = getByTestId('titlebar-account-avatar')
    expect(avatar.textContent).toBe('jane.doe@acme.io')
    expect(queryByTestId('account-codicon')).toBeNull()

    fireEvent.click(getByTestId('titlebar-account-button'))
    fireEvent.click(getByTestId('account-menu-sign-out'))
    expect(logout).toHaveBeenCalledTimes(1)
    expect(login).not.toHaveBeenCalled()
  })

  it('passes the Google photo URL to the avatar when present', async () => {
    getState.mockResolvedValue({ ...SIGNED_IN, user: { email: 'jane.doe@acme.io', photoUrl: 'https://x/p.png' } })
    const { getByTestId } = render(<AccountButton />)
    await waitFor(() => { expect(getByTestId('titlebar-account-avatar').getAttribute('data-image')).toBe('https://x/p.png') })
  })
})
