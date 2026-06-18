import { describe, it, expect, afterEach, vi } from 'vitest'

// WindowManager imports `app` only for isDevToolsEnabled(); these tests don't
// touch it, but the module-level import must resolve.
vi.mock('electron', () => ({ app: { isPackaged: false } }))

import {
  isInactiveRevealRequested,
  clearStartupActivationEnv,
  STARTUP_ACTIVATION_ENV_VARS
} from './WindowManager'

describe('isInactiveRevealRequested', () => {
  const ORIGINAL_ARGV = process.argv

  afterEach(() => {
    process.argv = ORIGINAL_ARGV
  })

  it('is false without the flag', () => {
    process.argv = ['node', 'main.js']
    expect(isInactiveRevealRequested()).toBe(false)
  })

  it('is true with --inactive-window', () => {
    process.argv = ['node', 'main.js', '--inactive-window']
    expect(isInactiveRevealRequested()).toBe(true)
  })
})

describe('clearStartupActivationEnv', () => {
  it('removes the Wayland/X11 activation tokens and reports them', () => {
    const env: NodeJS.ProcessEnv = {
      XDG_ACTIVATION_TOKEN: 'tok-abc',
      DESKTOP_STARTUP_ID: 'startup-1',
      PATH: '/usr/bin'
    }

    const cleared = clearStartupActivationEnv(env)

    expect(cleared.sort()).toEqual([...STARTUP_ACTIVATION_ENV_VARS].sort())
    expect(env['XDG_ACTIVATION_TOKEN']).toBeUndefined()
    expect(env['DESKTOP_STARTUP_ID']).toBeUndefined()
    // Unrelated variables are untouched.
    expect(env['PATH']).toBe('/usr/bin')
  })

  it('is a no-op (returns []) when no token is present', () => {
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' }

    const cleared = clearStartupActivationEnv(env)

    expect(cleared).toEqual([])
    expect(env['PATH']).toBe('/usr/bin')
  })

  it('clears only the token that is set', () => {
    const env: NodeJS.ProcessEnv = { XDG_ACTIVATION_TOKEN: 'tok' }

    expect(clearStartupActivationEnv(env)).toEqual(['XDG_ACTIVATION_TOKEN'])
    expect(env['XDG_ACTIVATION_TOKEN']).toBeUndefined()
  })
})
