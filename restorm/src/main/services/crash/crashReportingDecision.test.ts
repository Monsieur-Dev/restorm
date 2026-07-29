import { describe, it, expect } from 'vitest'
import { shouldInitCrashReporting, shouldPromptForCrashConsent } from './crashReportingDecision'
import type { ConsentDecision } from 'electron-core-ui/main'

const DSN = 'https://k@o4507.ingest.de.sentry.io/1'

function decision(overrides: Partial<ConsentDecision>): ConsentDecision {
  return {
    gate: 'crash',
    granted: true,
    consentedAt: null,
    policyVersion: null,
    source: 'default',
    ...overrides
  }
}

describe('shouldInitCrashReporting — nothing is armed by accident', () => {
  it('does not arm without a DSN, whatever the consent says', () => {
    expect(shouldInitCrashReporting({ dsn: undefined, consent: decision({ source: 'user', granted: true }) }))
      .toEqual({ init: false, reason: 'no-dsn' })
  })

  it('does not arm when the consent gate does not exist yet', () => {
    // The window between app boot and the consent service being built.
    expect(shouldInitCrashReporting({ dsn: DSN, consent: null }))
      .toEqual({ init: false, reason: 'no-gate' })
  })

  it('arms for a plan that mandates reporting', () => {
    expect(shouldInitCrashReporting({ dsn: DSN, consent: decision({ source: 'forced-on' }) }))
      .toEqual({ init: true, reason: 'plan-mandatory' })
  })

  it('does not arm for a plan that forbids reporting', () => {
    expect(shouldInitCrashReporting({ dsn: DSN, consent: decision({ source: 'forced-off', granted: false }) }))
      .toEqual({ init: false, reason: 'plan-forbidden' })
  })

  it('arms when the user explicitly granted', () => {
    expect(shouldInitCrashReporting({ dsn: DSN, consent: decision({ source: 'user', granted: true }) }))
      .toEqual({ init: true, reason: 'consent-granted' })
  })

  it('does not arm when the user explicitly declined', () => {
    expect(shouldInitCrashReporting({ dsn: DSN, consent: decision({ source: 'user', granted: false }) }))
      .toEqual({ init: false, reason: 'consent-declined' })
  })
})

describe('shouldInitCrashReporting — the unanswered window', () => {
  it('does NOT arm while consent is unanswered, even though the stored value is true', () => {
    // The decisive case. The gate's stored default is `true` (the tier model
    // calls paid plans "opt-out"), but nothing may leave the machine before the
    // user has actually been asked — so an unanswered gate is a refusal and the
    // prompt does the asking.
    const unanswered = decision({ source: 'default', granted: true })
    expect(unanswered.granted).toBe(true)
    expect(shouldInitCrashReporting({ dsn: DSN, consent: unanswered }))
      .toEqual({ init: false, reason: 'consent-unanswered' })
  })

  it('arms as soon as that same user answers yes', () => {
    expect(shouldInitCrashReporting({ dsn: DSN, consent: decision({ source: 'user', granted: true }) }).init)
      .toBe(true)
  })
})

describe('shouldPromptForCrashConsent', () => {
  it('prompts only when the user has a choice they have not yet made', () => {
    expect(shouldPromptForCrashConsent(decision({ source: 'default' }))).toBe(true)
  })

  it('never prompts an account whose plan already decides', () => {
    // Community is plan-mandated, so there is nothing to ask; the settings row
    // explains the tier instead.
    expect(shouldPromptForCrashConsent(decision({ source: 'forced-on' }))).toBe(false)
    expect(shouldPromptForCrashConsent(decision({ source: 'forced-off' }))).toBe(false)
  })

  it('never re-prompts someone who already answered', () => {
    expect(shouldPromptForCrashConsent(decision({ source: 'user', granted: true }))).toBe(false)
    expect(shouldPromptForCrashConsent(decision({ source: 'user', granted: false }))).toBe(false)
  })

  it('does not prompt before the consent gate exists', () => {
    expect(shouldPromptForCrashConsent(null)).toBe(false)
  })
})
