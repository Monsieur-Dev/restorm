import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, waitFor, act } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import type { AuthState, PlanTier } from '../../../../shared/auth/authState'

// ECUI resolves to its built dist in vitest, whose CSS side-imports don't
// resolve. Stub the shared StatusbarElement with a minimal div that surfaces
// the `title` text + `data-testid` this component renders.
vi.mock('electron-core-ui/renderer', () => ({
  StatusbarElement: (props: { title?: ReactNode; 'data-testid'?: string }): ReactNode =>
    createElement(
      'div',
      { ...(props['data-testid'] ? { 'data-testid': props['data-testid'] } : {}) },
      props.title
    )
}))

import { StatusbarVersionPlan } from './StatusbarVersionPlan'

const TESTID = 'app-statusbar-version-plan'

const makeState = (plan: PlanTier): AuthState => ({
  signedIn: plan !== 'community',
  user: plan === 'community' ? null : { email: 'u@example.com' },
  plan,
  capabilities: []
})

/** The captured `onStateChanged` listener, so a test can push a live update. */
let stateListener: ((state: AuthState) => void) | null = null
const unsubscribe = vi.fn()

function installApi(opts: { version: string; initialPlan: PlanTier }): void {
  stateListener = null
  ;(window as unknown as { api: unknown }).api = {
    app: {
      getVersion: vi.fn(() => Promise.resolve(opts.version))
    },
    account: {
      getState: vi.fn(() => Promise.resolve(makeState(opts.initialPlan))),
      onStateChanged: vi.fn((cb: (state: AuthState) => void) => {
        stateListener = cb
        return unsubscribe
      })
    }
  }
}

beforeEach(() => {
  unsubscribe.mockClear()
})

afterEach(() => {
  cleanup()
  delete (window as unknown as { api?: unknown }).api
})

describe('StatusbarVersionPlan', () => {
  it('renders the app version (incl. -preview suffix) once resolved', async () => {
    installApi({ version: '0.1.12-preview', initialPlan: 'community' })
    const { getByTestId } = render(<StatusbarVersionPlan />)
    await waitFor(() => {
      expect(getByTestId(TESTID).textContent).toContain('Restorm v0.1.12-preview')
    })
  })

  it('shows the Community placeholder before/without entitlement', async () => {
    installApi({ version: '0.1.12-preview', initialPlan: 'community' })
    const { getByTestId } = render(<StatusbarVersionPlan />)
    // Renders synchronously with the Community default even before the async
    // version/state resolve — the slot always exists.
    expect(getByTestId(TESTID).textContent).toContain('Community')
    await waitFor(() => {
      expect(getByTestId(TESTID).textContent).toBe('Restorm v0.1.12-preview - Community')
    })
  })

  it('reflects the current plan from auth state (Pro)', async () => {
    installApi({ version: '0.1.12-preview', initialPlan: 'pro' })
    const { getByTestId } = render(<StatusbarVersionPlan />)
    await waitFor(() => {
      expect(getByTestId(TESTID).textContent).toBe('Restorm v0.1.12-preview - Pro')
    })
  })

  it('updates live on logout back to the Community placeholder', async () => {
    installApi({ version: '0.1.12-preview', initialPlan: 'enterprise' })
    const { getByTestId } = render(<StatusbarVersionPlan />)
    await waitFor(() => {
      expect(getByTestId(TESTID).textContent).toContain('Enterprise')
    })
    // Simulate a logout broadcast via onStateChanged.
    act(() => {
      stateListener?.(makeState('community'))
    })
    await waitFor(() => {
      expect(getByTestId(TESTID).textContent).toBe('Restorm v0.1.12-preview - Community')
    })
  })

  it('detaches the state subscription on unmount', async () => {
    installApi({ version: '0.1.12-preview', initialPlan: 'community' })
    const { unmount, getByTestId } = render(<StatusbarVersionPlan />)
    await waitFor(() => { expect(getByTestId(TESTID)).toBeTruthy() })
    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
