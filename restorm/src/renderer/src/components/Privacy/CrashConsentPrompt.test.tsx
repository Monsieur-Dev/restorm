import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import type { CrashConsentState } from '../../../../shared/crash/crashTypes'

const pushMock = vi.fn()
const dismissMock = vi.fn()
vi.mock('electron-core-ui/renderer', () => ({
  toasterService: {
    push: (id: string, input: unknown): string => { pushMock(id, input); return 'toast' },
    dismiss: (id: string, toastId: string): void => { dismissMock(id, toastId) }
  },
  Button: (props: { children?: ReactNode; onClick?: () => void }): ReactNode =>
    createElement('button', { onClick: props.onClick }, props.children),
  Toggle: (props: { checked?: boolean; children?: ReactNode }): ReactNode =>
    createElement('span', { 'data-checked': String(props.checked) }, props.children)
}))

vi.mock('react-i18next', () => ({
  useTranslation: (): { t: (key: string) => string } => ({ t: (key: string) => key })
}))

import { CrashConsentPrompt } from './CrashConsentPrompt'

/** Installs a `window.api.crash` whose push channel the test can drive. */
function installApi(initial: CrashConsentState): {
  push: (state: CrashConsentState) => void
  setConsent: ReturnType<typeof vi.fn>
  unsubscribe: ReturnType<typeof vi.fn>
} {
  let listener: ((state: CrashConsentState) => void) | null = null
  const setConsent = vi.fn().mockResolvedValue(initial)
  const unsubscribe = vi.fn()
  ;(window as unknown as { api: unknown }).api = {
    crash: {
      getConsentState: () => Promise.resolve(initial),
      onConsentStateChanged: (cb: (state: CrashConsentState) => void) => {
        listener = cb
        return unsubscribe
      },
      setConsent
    }
  }
  return { push: (state) => { listener?.(state) }, setConsent, unsubscribe }
}

const UNANSWERED: CrashConsentState = { shouldPrompt: true, granted: true }
const ANSWERED: CrashConsentState = { shouldPrompt: false, granted: true }

describe('CrashConsentPrompt', () => {
  beforeEach(() => { pushMock.mockClear(); dismissMock.mockClear() })
  afterEach(() => { cleanup() })

  it('prompts while the user still owes an answer', async () => {
    installApi(UNANSWERED)
    render(createElement(CrashConsentPrompt))
    await waitFor(() => { expect(pushMock).toHaveBeenCalledTimes(1) })
    const [toasterId, input] = pushMock.mock.calls[0] as [string, { id: string; durationMs?: number }]
    expect(toasterId).toBe('app')
    expect(input.id).toBe('restorm:crash-consent')
    // No auto-dismiss: a consent prompt that expired on its own would let
    // silence stand in for an answer.
    expect(input.durationMs).toBeUndefined()
  })

  it('does not prompt once the answer has been given', async () => {
    installApi(ANSWERED)
    render(createElement(CrashConsentPrompt))
    await waitFor(() => { expect(pushMock).not.toHaveBeenCalled() })
  })

  it('never prompts an account whose plan decides for them', async () => {
    // Community resolves plan-mandated rather than unanswered, so the main
    // process reports `shouldPrompt: false` and no plan check is needed here.
    installApi({ shouldPrompt: false, granted: true })
    render(createElement(CrashConsentPrompt))
    await waitFor(() => { expect(pushMock).not.toHaveBeenCalled() })
  })

  it('prompts on promotion, when the plan stops answering for the user', async () => {
    const api = installApi({ shouldPrompt: false, granted: true })
    render(createElement(CrashConsentPrompt))
    await waitFor(() => { expect(pushMock).not.toHaveBeenCalled() })

    api.push(UNANSWERED)

    await waitFor(() => { expect(pushMock).toHaveBeenCalledTimes(1) })
  })

  it('does not re-push while the prompt is already open', async () => {
    // Re-pushing resets the toast and would wipe a checkbox the user had
    // changed but not yet saved.
    const api = installApi(UNANSWERED)
    render(createElement(CrashConsentPrompt))
    await waitFor(() => { expect(pushMock).toHaveBeenCalledTimes(1) })

    api.push(UNANSWERED)
    api.push(UNANSWERED)

    expect(pushMock).toHaveBeenCalledTimes(1)
  })

  it('dismisses the prompt once the answer is recorded', async () => {
    const api = installApi(UNANSWERED)
    render(createElement(CrashConsentPrompt))
    await waitFor(() => { expect(pushMock).toHaveBeenCalledTimes(1) })

    api.push(ANSWERED)

    await waitFor(() => { expect(dismissMock).toHaveBeenCalledWith('app', 'restorm:crash-consent') })
  })

  it('records the answer through the consent channel, not a settings write', async () => {
    const api = installApi(UNANSWERED)
    render(createElement(CrashConsentPrompt))
    await waitFor(() => { expect(pushMock).toHaveBeenCalledTimes(1) })

    const [, input] = pushMock.mock.calls[0] as [string, { body: { props: { onSave: (g: boolean) => void } } }]
    input.body.props.onSave(false)

    expect(api.setConsent).toHaveBeenCalledWith(false)
  })

  it('stays silent when the bridge is missing rather than breaking the app', async () => {
    ;(window as unknown as { api: unknown }).api = {}
    expect(() => render(createElement(CrashConsentPrompt))).not.toThrow()
    await waitFor(() => { expect(pushMock).not.toHaveBeenCalled() })
  })

  it('detaches its subscription on unmount', async () => {
    const api = installApi(ANSWERED)
    const view = render(createElement(CrashConsentPrompt))
    await waitFor(() => { expect(api.unsubscribe).not.toHaveBeenCalled() })
    view.unmount()
    expect(api.unsubscribe).toHaveBeenCalledTimes(1)
  })
})
