// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const push = vi.fn()
// The real `electron-core-ui/renderer` barrel pulls in CSS/effects unneeded
// here; stub it to just the surface this module uses. `i18n.t` returns the
// fallback so assertions can match on the resolved string.
vi.mock('electron-core-ui/renderer', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
  toasterService: { push: (...args: unknown[]): void => { push(...args) } },
  i18n: { t: (_key: string, fallback: string) => fallback }
}))

import { subscribeToPro } from './subscribeToPro'
import type { AuthState, CheckoutResult } from '../../../shared/auth/authState'

const PRO_IN: AuthState = { signedIn: true, user: { email: 'a@b.com' }, plan: 'pro', capabilities: [] }
const SIGNED_OUT: AuthState = { signedIn: false, user: null, plan: 'community', capabilities: [] }

beforeEach(() => { push.mockClear() })
afterEach(() => { delete (window as { api?: unknown }).api })

function stub(account: {
  getState: () => Promise<AuthState>
  login?: () => Promise<AuthState>
  subscribe?: () => Promise<CheckoutResult>
}): void {
  ;(window as unknown as { api: unknown }).api = { account }
}

describe('subscribeToPro', () => {
  it('subscribes directly when already signed in (no login prompt, no toast on success)', async () => {
    const login = vi.fn()
    const subscribe = vi.fn(() => Promise.resolve<CheckoutResult>({ status: 'opened' }))
    stub({ getState: () => Promise.resolve(PRO_IN), login, subscribe })
    await subscribeToPro()
    expect(login).not.toHaveBeenCalled()
    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(push).not.toHaveBeenCalled()
  })

  it('prompts login first when signed out, then subscribes on success', async () => {
    const login = vi.fn(() => Promise.resolve(PRO_IN))
    const subscribe = vi.fn(() => Promise.resolve<CheckoutResult>({ status: 'opened' }))
    stub({ getState: () => Promise.resolve(SIGNED_OUT), login, subscribe })
    await subscribeToPro()
    expect(login).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledTimes(1)
  })

  it('aborts without subscribing when login is cancelled / fails', async () => {
    const login = vi.fn(() => Promise.resolve(SIGNED_OUT))
    const subscribe = vi.fn(() => Promise.resolve<CheckoutResult>({ status: 'opened' }))
    stub({ getState: () => Promise.resolve(SIGNED_OUT), login, subscribe })
    await subscribeToPro()
    expect(login).toHaveBeenCalledTimes(1)
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('toasts the admin-only message on a forbidden (403) result', async () => {
    const subscribe = vi.fn(() => Promise.resolve<CheckoutResult>({ status: 'forbidden' }))
    stub({ getState: () => Promise.resolve(PRO_IN), subscribe })
    await subscribeToPro()
    expect(push).toHaveBeenCalledTimes(1)
    const [, toast] = push.mock.calls[0] as [string, { title: string }]
    expect(toast.title).toMatch(/administrateur/i)
  })

  it('toasts a generic error on an error result', async () => {
    const subscribe = vi.fn(() => Promise.resolve<CheckoutResult>({ status: 'error' }))
    stub({ getState: () => Promise.resolve(PRO_IN), subscribe })
    await subscribeToPro()
    expect(push).toHaveBeenCalledTimes(1)
    const [, toast] = push.mock.calls[0] as [string, { title: string }]
    expect(toast.title).toMatch(/abonnement/i)
  })
})
