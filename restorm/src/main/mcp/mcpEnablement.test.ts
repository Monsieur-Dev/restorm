import { describe, it, expect } from 'vitest'
import { isHeadlessHost, isMcpEnabledForLaunch, shouldLaunchInactive } from './mcpEnablement'

describe('isHeadlessHost', () => {
  it('is headless on linux with no DISPLAY and no WAYLAND_DISPLAY', () => {
    expect(isHeadlessHost({ platform: 'linux', env: {} })).toBe(true)
    expect(isHeadlessHost({ platform: 'linux', env: { DISPLAY: '', WAYLAND_DISPLAY: '  ' } })).toBe(true)
  })

  it('is NOT headless on linux with an X11 DISPLAY (e.g. xvfb)', () => {
    expect(isHeadlessHost({ platform: 'linux', env: { DISPLAY: ':99' } })).toBe(false)
  })

  it('is NOT headless on linux with a Wayland display', () => {
    expect(isHeadlessHost({ platform: 'linux', env: { WAYLAND_DISPLAY: 'wayland-0' } })).toBe(false)
  })

  it('is never headless on macOS / Windows regardless of env', () => {
    expect(isHeadlessHost({ platform: 'darwin', env: {} })).toBe(false)
    expect(isHeadlessHost({ platform: 'win32', env: {} })).toBe(false)
  })
})

describe('isMcpEnabledForLaunch', () => {
  const withDisplay = { platform: 'linux' as const, env: { DISPLAY: ':0' } }
  const headless = { platform: 'linux' as const, env: {} }

  it('is ON by default (setting never set / undefined) when a display exists', () => {
    expect(isMcpEnabledForLaunch({ settingValue: undefined, ...withDisplay })).toBe(true)
  })

  it('treats the settings store empty-string default as ON', () => {
    expect(isMcpEnabledForLaunch({ settingValue: '', ...withDisplay })).toBe(true)
  })

  it('is ON when the setting is explicitly true', () => {
    expect(isMcpEnabledForLaunch({ settingValue: true, ...withDisplay })).toBe(true)
  })

  it('is OFF only when the setting is an explicit false', () => {
    expect(isMcpEnabledForLaunch({ settingValue: false, ...withDisplay })).toBe(false)
  })

  it('is OFF on a headless host even when the setting is ON', () => {
    expect(isMcpEnabledForLaunch({ settingValue: true, ...headless })).toBe(false)
    expect(isMcpEnabledForLaunch({ settingValue: undefined, ...headless })).toBe(false)
  })

  it('keeps MCP ON under a virtual display (xvfb e2e is not headless)', () => {
    expect(isMcpEnabledForLaunch({ settingValue: undefined, platform: 'linux', env: { DISPLAY: ':99' } })).toBe(true)
  })
})

describe('shouldLaunchInactive', () => {
  it('launches ACTIVE (false) for a normal user — no test marker', () => {
    expect(shouldLaunchInactive({})).toBe(false)
    expect(shouldLaunchInactive({ RESTORM_USER_DATA_OVERRIDE: '' })).toBe(false)
  })

  it('launches inactive (true) only under the e2e/test marker', () => {
    expect(shouldLaunchInactive({ RESTORM_USER_DATA_OVERRIDE: '/tmp/userdata/abc' })).toBe(true)
  })
})
