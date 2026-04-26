/**
 * Unit tests for `applyUserDataOverride`.
 *
 * The helper is the test-isolation hook that redirects Electron's
 * `userData` to a per-run dir when `RESTORM_USER_DATA_OVERRIDE` is
 * set. Production / dev runs leave the var unset and behaviour is
 * unchanged.
 */

import { describe, it, expect, vi } from 'vitest'
import { applyUserDataOverride } from '../../src/main/userDataOverride'

function makeAppMock(): { setPath: ReturnType<typeof vi.fn> } {
  return { setPath: vi.fn() }
}

describe('applyUserDataOverride', () => {
  it('calls app.setPath("userData", value) once when the env var is set', () => {
    const app = makeAppMock()
    const result = applyUserDataOverride(app, { RESTORM_USER_DATA_OVERRIDE: '/tmp/xyz' })
    expect(app.setPath).toHaveBeenCalledExactlyOnceWith('userData', '/tmp/xyz')
    expect(result).toEqual({ applied: true, path: '/tmp/xyz' })
  })

  it('trims surrounding whitespace before applying', () => {
    const app = makeAppMock()
    const result = applyUserDataOverride(app, { RESTORM_USER_DATA_OVERRIDE: '  /tmp/spaced  ' })
    expect(app.setPath).toHaveBeenCalledExactlyOnceWith('userData', '/tmp/spaced')
    expect(result.applied).toBe(true)
  })

  it('does nothing when the env var is unset', () => {
    const app = makeAppMock()
    const result = applyUserDataOverride(app, {})
    expect(app.setPath).not.toHaveBeenCalled()
    expect(result).toEqual({ applied: false })
  })

  it('does nothing when the env var is the empty string', () => {
    const app = makeAppMock()
    const result = applyUserDataOverride(app, { RESTORM_USER_DATA_OVERRIDE: '' })
    expect(app.setPath).not.toHaveBeenCalled()
    expect(result).toEqual({ applied: false })
  })

  it('does nothing when the env var contains only whitespace', () => {
    const app = makeAppMock()
    const result = applyUserDataOverride(app, { RESTORM_USER_DATA_OVERRIDE: '   \t  ' })
    expect(app.setPath).not.toHaveBeenCalled()
    expect(result).toEqual({ applied: false })
  })

  it('falls back to process.env when no env arg is provided', () => {
    const app = makeAppMock()
    const original = process.env['RESTORM_USER_DATA_OVERRIDE']
    process.env['RESTORM_USER_DATA_OVERRIDE'] = '/tmp/from-process-env'
    try {
      const result = applyUserDataOverride(app)
      expect(app.setPath).toHaveBeenCalledExactlyOnceWith('userData', '/tmp/from-process-env')
      expect(result.applied).toBe(true)
    } finally {
      if (original === undefined) delete process.env['RESTORM_USER_DATA_OVERRIDE']
      else process.env['RESTORM_USER_DATA_OVERRIDE'] = original
    }
  })
})
