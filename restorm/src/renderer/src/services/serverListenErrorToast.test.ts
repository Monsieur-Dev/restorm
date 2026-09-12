import { describe, it, expect, vi, beforeEach } from 'vitest'

const warn = vi.fn()
const error = vi.fn()

vi.mock('electron-core-ui/renderer', () => ({
  toasterService: { push: vi.fn() },
  logger: {
    warn: (...a: unknown[]): void => { warn(...a) },
    error: (...a: unknown[]): void => { error(...a) }
  }
}))
vi.mock('../components/ScenarioToastBody', () => ({
  ScenarioToastTitle: () => null,
  ScenarioToastBody: () => null
}))

import { isExpectedListenError, logServerListenFailure } from './serverListenErrorToast'

describe('isExpectedListenError', () => {
  it('flags a user-fixable bind/listen failure (kept OUT of crash reporting)', () => {
    for (const s of [
      'listen EADDRINUSE: address already in use 0.0.0.0:8080',
      'Error: listen EADDRINUSE: address already in use :::8080',
      'EACCES: permission denied 0.0.0.0:80',
      'listen EADDRNOTAVAIL: address not available 10.0.0.1:9000',
      'bind EADDRINVAL'
    ]) {
      expect(isExpectedListenError(s)).toBe(true)
    }
  })

  it('does NOT flag a genuinely unexpected failure', () => {
    expect(isExpectedListenError('TypeError: undefined is not a function')).toBe(false)
    expect(isExpectedListenError('ECONNREFUSED 127.0.0.1:5432')).toBe(false)
    expect(isExpectedListenError('')).toBe(false)
  })
})

describe('logServerListenFailure', () => {
  beforeEach(() => {
    warn.mockClear()
    error.mockClear()
  })

  it('logs an expected bind error at warn — below the Sentry log bridge', () => {
    logServerListenFailure('HTTP mock server failed to listen', 'listen EADDRINUSE: address already in use :::8080')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(error).not.toHaveBeenCalled()
  })

  it('logs a genuinely unexpected failure at error — still bridged to Sentry', () => {
    logServerListenFailure('HTTP mock server listen error', new Error('boom'))
    expect(error).toHaveBeenCalledTimes(1)
    expect(warn).not.toHaveBeenCalled()
  })
})
