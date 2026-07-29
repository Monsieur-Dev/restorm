import { describe, it, expect } from 'vitest'
import {
  OBSERVABILITY_ENDPOINTS,
  CONSENT_SETTING_KEYS,
  PRIVACY_POLICY_URL,
  PRIVACY_POLICY_VERSION,
  endpointForGate,
  isCrashUrl,
  isObservabilityUrl,
  isTelemetryUrl
} from './observability'
import enTranslation from '../../renderer/locales/en/translation.json'
import frTranslation from '../../renderer/locales/fr/translation.json'

describe('observability endpoint declarations', () => {
  it('declares exactly one endpoint per consent gate', () => {
    expect(endpointForGate('crash')).toBeDefined()
    expect(endpointForGate('telemetry')).toBeDefined()
    expect(OBSERVABILITY_ENDPOINTS).toHaveLength(2)
  })

  it('declares every host as a bare, wildcard-free hostname', () => {
    for (const endpoint of OBSERVABILITY_ENDPOINTS) {
      expect(endpoint.host).not.toContain('*')
      expect(endpoint.host).not.toContain('/')
      expect(endpoint.host).toBe(endpoint.host.toLowerCase())
    }
  })

  it('backs every gate with a settings key and carries a purpose key for the firewall panel', () => {
    for (const endpoint of OBSERVABILITY_ENDPOINTS) {
      expect(CONSENT_SETTING_KEYS[endpoint.consentGate]).toMatch(/^privacy:/)
      expect(endpoint.purposeKey).toMatch(/^privacy\.outbound\.purpose\./)
    }
  })

  it('stamps a policy version consent decisions can be compared against', () => {
    expect(PRIVACY_POLICY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('points both consent descriptions at the policy the constant names', () => {
    // The consent surface has to say what the user is agreeing to. Settings
    // descriptions are plain text, so the URL is spelled out in the copy —
    // which is exactly how it silently drifts from the constant.
    for (const translation of [enTranslation, frTranslation]) {
      expect(translation.privacy.crashReportsDescription).toContain(PRIVACY_POLICY_URL)
      expect(translation.privacy.telemetryDescription).toContain(PRIVACY_POLICY_URL)
    }
  })
})

describe('isObservabilityUrl — exact host over https only', () => {
  const crashHost = endpointForGate('crash')?.host ?? ''
  const telemetryHost = endpointForGate('telemetry')?.host ?? ''

  it('accepts the declared host over https', () => {
    expect(isCrashUrl(`https://${crashHost}/api/1/envelope/`)).toBe(true)
    expect(isTelemetryUrl(`https://${telemetryHost}/i/v0/e/`)).toBe(true)
  })

  it('accepts the host case-insensitively', () => {
    expect(isCrashUrl(`https://${crashHost.toUpperCase()}/x`)).toBe(true)
  })

  it('refuses plaintext http — a downgrade would ship diagnostics in the clear', () => {
    expect(isCrashUrl(`http://${crashHost}/x`)).toBe(false)
  })

  it('refuses a look-alike host that merely contains or extends the declared one', () => {
    expect(isCrashUrl('https://evil-errors.restorm.app/x')).toBe(false)
    expect(isCrashUrl(`https://${crashHost}.attacker.net/x`)).toBe(false)
    expect(isCrashUrl(`https://sub.${crashHost}/x`)).toBe(false)
  })

  it('refuses an explicit non-default port on the declared host', () => {
    expect(isCrashUrl(`https://${crashHost}:8443/x`)).toBe(false)
  })

  it('refuses a host declared for a DIFFERENT gate', () => {
    expect(isObservabilityUrl(`https://${telemetryHost}/x`, 'crash')).toBe(false)
    expect(isObservabilityUrl(`https://${crashHost}/x`, 'telemetry')).toBe(false)
  })

  it('refuses an unparsable URL instead of throwing', () => {
    expect(isCrashUrl('not a url')).toBe(false)
    expect(isCrashUrl('')).toBe(false)
  })
})
