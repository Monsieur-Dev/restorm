/**
 * The env var that arms the firewall's blanket test bypass.
 *
 * This predicate decides whether a security control is on, so the cases
 * that matter most are the ones where it must stay OFF. It used to be
 * inferred from the `userData` redirect, which meant any launch wanting an
 * isolated profile silently disarmed the firewall too; these tests pin the
 * separation so the two can't drift back together.
 */

import { describe, it, expect } from 'vitest'
import { isFirewallE2EBypassArmed, FIREWALL_E2E_BYPASS_ENV } from '../../src/main/config/firewallE2EBypass'

describe('isFirewallE2EBypassArmed', () => {
  it('is off when the variable is absent — the safe default', () => {
    expect(isFirewallE2EBypassArmed({})).toBe(false)
  })

  it('is armed by the documented opt-in values', () => {
    expect(isFirewallE2EBypassArmed({ [FIREWALL_E2E_BYPASS_ENV]: '1' })).toBe(true)
    expect(isFirewallE2EBypassArmed({ [FIREWALL_E2E_BYPASS_ENV]: 'true' })).toBe(true)
    expect(isFirewallE2EBypassArmed({ [FIREWALL_E2E_BYPASS_ENV]: 'TRUE' })).toBe(true)
    expect(isFirewallE2EBypassArmed({ [FIREWALL_E2E_BYPASS_ENV]: ' 1 ' })).toBe(true)
  })

  it('stays off for values that only look enabling', () => {
    // A control that disables itself on any non-empty string is the failure
    // mode this replaces — `RESTORM_USER_DATA_OVERRIDE` disarmed the firewall
    // merely by holding a directory path.
    for (const value of ['', '  ', '0', 'false', 'no', 'off', '/tmp/some/userdata/dir']) {
      expect(isFirewallE2EBypassArmed({ [FIREWALL_E2E_BYPASS_ENV]: value })).toBe(false)
    }
  })

  it('is NOT armed by the userData redirect, which is a separate concern', () => {
    // The whole point of the split: an isolated profile must not imply a
    // disarmed firewall. A launch can now have one without the other.
    expect(isFirewallE2EBypassArmed({ RESTORM_USER_DATA_OVERRIDE: '/tmp/e2e/userdata/abc' })).toBe(false)
  })
})
