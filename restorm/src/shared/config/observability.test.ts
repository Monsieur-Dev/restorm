import { describe, it, expect } from 'vitest'
import {
  resolveObservabilityEndpoints,
  ingestHostFromDsn,
  crashDsn,
  CRASH_DSN_ENV,
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
    expect(resolveObservabilityEndpoints()).toHaveLength(2)
  })

  it('declares every host as a bare, wildcard-free hostname', () => {
    for (const endpoint of resolveObservabilityEndpoints()) {
      expect(endpoint.host).not.toContain('*')
      expect(endpoint.host).not.toContain('/')
      expect(endpoint.host).toBe(endpoint.host.toLowerCase())
    }
  })

  it('backs every gate with a settings key and carries a purpose key for the firewall panel', () => {
    for (const endpoint of resolveObservabilityEndpoints()) {
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

describe('crash ingest host derives from the DSN', () => {
  const DSN = 'https://abc123def456@o4507.ingest.de.sentry.io/1234567'

  it('exempts the host the SDK will actually send to', () => {
    // The whole point: the allowlist is derived from the DSN rather than kept
    // in a parallel constant, so it cannot drift from the destination.
    const endpoints = resolveObservabilityEndpoints({ [CRASH_DSN_ENV]: DSN })
    expect(endpoints.find((e) => e.id === 'crash')?.host).toBe('o4507.ingest.de.sentry.io')
  })

  it('follows the DSN when it changes, with no code change', () => {
    const other = 'https://k@o9999.ingest.us.sentry.io/42'
    expect(resolveObservabilityEndpoints({ [CRASH_DSN_ENV]: other }).find((e) => e.id === 'crash')?.host)
      .toBe('o9999.ingest.us.sentry.io')
  })

  it('falls back to an unroutable placeholder when no DSN is configured', () => {
    // The row still renders (the user can see crash reporting is a declared
    // destination) but points at a host that cannot receive anything.
    expect(resolveObservabilityEndpoints({}).find((e) => e.id === 'crash')?.host)
      .toBe('o0.ingest.de.sentry.io')
  })

  it('treats an unparsable or non-https DSN as absent rather than guessing', () => {
    expect(ingestHostFromDsn(undefined)).toBeNull()
    expect(ingestHostFromDsn('')).toBeNull()
    expect(ingestHostFromDsn('   ')).toBeNull()
    expect(ingestHostFromDsn('not a dsn')).toBeNull()
    expect(ingestHostFromDsn('http://k@o1.ingest.de.sentry.io/1')).toBeNull()
  })

  it('reads and trims the DSN from the environment', () => {
    expect(crashDsn({ [CRASH_DSN_ENV]: `  ${DSN}  ` })).toBe(DSN)
    expect(crashDsn({})).toBeUndefined()
    expect(crashDsn({ [CRASH_DSN_ENV]: '  ' })).toBeUndefined()
  })

  it('keeps the eligibility predicate in step with the derived host', () => {
    const env = { [CRASH_DSN_ENV]: DSN }
    expect(isCrashUrl('https://o4507.ingest.de.sentry.io/api/1234567/envelope/', env)).toBe(true)
    expect(isCrashUrl('https://o0.ingest.de.sentry.io/api/1/envelope/', env)).toBe(false)
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
