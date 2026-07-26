import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import type { UpdateState } from '../../../../shared/update/updateTypes'

vi.mock('electron-core-ui/renderer', () => ({
  Button: (props: {
    children?: ReactNode
    onClick?: () => void
    disabled?: boolean
    'data-testid'?: string
  }): ReactNode =>
    createElement(
      'button',
      {
        onClick: props.onClick,
        disabled: props.disabled,
        'data-testid': props['data-testid']
      },
      props.children
    )
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && 'version' in opts ? `${key}:${String(opts['version'])}` : key
  })
}))

import { UpdateActionsRenderer } from './UpdateActionsRenderer'

const baseState = (over: Partial<UpdateState> = {}): UpdateState => ({
  phase: 'idle',
  version: null,
  currentVersion: '1.2.0',
  percent: null,
  lastCheckedAt: null,
  error: null,
  trigger: null,
  ...over
})

const checkNowMock = vi.fn(() => Promise.resolve(baseState({ phase: 'checking' })))

function installApi(initial: UpdateState): void {
  ;(window as unknown as { api: unknown }).api = {
    update: {
      getState: vi.fn(() => Promise.resolve(initial)),
      getSettings: vi.fn(() =>
        Promise.resolve({ autoCheckEnabled: true, currentVersion: '1.2.0' })
      ),
      checkNow: checkNowMock,
      onStateChanged: vi.fn(() => vi.fn())
    }
  }
}

// The renderer ignores its props (it is a live action control); a minimally
// shaped, spreadable object typed to the component's own props satisfies TS.
const noopSetting = {
  setting: { setting: { id: 'status', titleKey: 't', type: 'update-actions', default: '' } },
  value: '',
  onChange: vi.fn()
} as unknown as Parameters<typeof UpdateActionsRenderer>[0]

beforeEach(() => checkNowMock.mockClear())
afterEach(() => {
  cleanup()
  delete (window as unknown as { api?: unknown }).api
})

describe('UpdateActionsRenderer', () => {
  it('renders the current version + idle status and a working "Check now"', async () => {
    installApi(baseState())
    render(<UpdateActionsRenderer {...noopSetting} />)
    await waitFor(() =>
      { expect(screen.getByText('updates.currentVersion:1.2.0')).toBeTruthy(); }
    )
    expect(screen.getByTestId('update-actions-status').textContent).toBe('updates.status.idle')

    act(() => {
      fireEvent.click(screen.getByTestId('update-check-now'))
    })
    expect(checkNowMock).toHaveBeenCalledTimes(1)
  })

  it('disables the button + shows the checking status while a check is in flight', async () => {
    installApi(baseState({ phase: 'checking' }))
    render(<UpdateActionsRenderer {...noopSetting} />)
    await waitFor(() =>
      { expect(screen.getByTestId('update-actions-status').textContent).toBe(
        'updates.status.checking'
      ); }
    )
    expect(screen.getByTestId('update-check-now').hasAttribute('disabled')).toBe(true)
  })
})
