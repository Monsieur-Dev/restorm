import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import type { CrashRecoveryNotice as CrashRecoveryNoticeState } from '../../../../shared/crash/crashTypes'

const pushMock = vi.fn()
vi.mock('electron-core-ui/renderer', () => ({
  toasterService: {
    push: (id: string, input: unknown): string => { pushMock(id, input); return 'toast' },
    dismiss: (): void => undefined
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: (): { t: (key: string, vars?: Record<string, unknown>) => string } => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars === undefined ? key : `${key}:${String(vars['file'])}`
  })
}))

import { CrashRecoveryNotice } from './CrashRecoveryNotice'

const NOTHING_WITHHELD: CrashRecoveryNoticeState = { fileWithheld: false, withheldPath: null }

/** Installs a `window.api.crash` whose push channel the test can drive. */
function installApi(initial: CrashRecoveryNoticeState): {
  push: (notice: CrashRecoveryNoticeState) => void
  unsubscribe: ReturnType<typeof vi.fn>
} {
  let listener: ((notice: CrashRecoveryNoticeState) => void) | null = null
  const unsubscribe = vi.fn()
  ;(window as unknown as { api: unknown }).api = {
    crash: {
      getRecoveryNotice: () => Promise.resolve(initial),
      onRecoveryNotice: (cb: (notice: CrashRecoveryNoticeState) => void) => {
        listener = cb
        return unsubscribe
      }
    }
  }
  return { push: (notice) => { listener?.(notice) }, unsubscribe }
}

afterEach(() => {
  cleanup()
  delete (window as { api?: unknown }).api
  vi.clearAllMocks()
})

beforeEach(() => {
  pushMock.mockClear()
})

describe('CrashRecoveryNotice', () => {
  it('says nothing on an ordinary launch', async () => {
    installApi(NOTHING_WITHHELD)
    render(<CrashRecoveryNotice />)
    await waitFor(() => { expect(pushMock).not.toHaveBeenCalled() })
  })

  it('names the withheld file when the push arrives', async () => {
    // The push is the path that matters: the withhold decision lands seconds
    // after this component mounts, so the initial read is always "no".
    const api = installApi(NOTHING_WITHHELD)
    render(<CrashRecoveryNotice />)
    await waitFor(() => { expect(pushMock).not.toHaveBeenCalled() })

    api.push({ fileWithheld: true, withheldPath: '/home/u/projects/Petstore.restorm' })

    await waitFor(() => { expect(pushMock).toHaveBeenCalledTimes(1) })
    const [, toast] = pushMock.mock.calls[0] as [string, { body: string }]
    expect(toast.body).toBe('crashRecovery.notice.body:Petstore.restorm')
  })

  it('still explains itself when the file is unknown', async () => {
    installApi({ fileWithheld: true, withheldPath: null })
    render(<CrashRecoveryNotice />)
    await waitFor(() => { expect(pushMock).toHaveBeenCalledTimes(1) })
    const [, toast] = pushMock.mock.calls[0] as [string, { body: string }]
    expect(toast.body).toBe('crashRecovery.notice.bodyUnnamed')
  })

  it('reads the notice for a renderer that missed the push', async () => {
    // A reload after the decision: no push will ever come, so the stored value
    // is the only way this window learns about it.
    installApi({ fileWithheld: true, withheldPath: '/tmp/a.restorm' })
    render(<CrashRecoveryNotice />)
    await waitFor(() => { expect(pushMock).toHaveBeenCalledTimes(1) })
  })

  it('tells the user once, not on every echo', async () => {
    const api = installApi({ fileWithheld: true, withheldPath: '/tmp/a.restorm' })
    render(<CrashRecoveryNotice />)
    await waitFor(() => { expect(pushMock).toHaveBeenCalledTimes(1) })

    api.push({ fileWithheld: true, withheldPath: '/tmp/a.restorm' })
    await waitFor(() => { expect(pushMock).toHaveBeenCalledTimes(1) })
  })

  it('does not throw when the bridge is missing', async () => {
    // The declaration promises the bridge; the preload that loaded may not.
    expect(() => render(<CrashRecoveryNotice />)).not.toThrow()
    await waitFor(() => { expect(pushMock).not.toHaveBeenCalled() })
  })
})
