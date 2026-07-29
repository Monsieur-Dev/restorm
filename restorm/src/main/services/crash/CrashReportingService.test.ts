import { describe, it, expect, vi } from 'vitest'
import { CrashReportingService, type CrashSdkPort, type CrashSdkInitOptions } from './CrashReportingService'
import type { ConsentDecision } from 'electron-core-ui/main'
import type { WindowCrashReport } from './windowCrashObserver'

const DSN = 'https://k@o4507.ingest.de.sentry.io/1'

function makeSdk(): CrashSdkPort & {
  inits: CrashSdkInitOptions[]
  closes: number
  captured: WindowCrashReport[]
} {
  const state = {
    inits: [] as CrashSdkInitOptions[],
    closes: 0,
    captured: [] as WindowCrashReport[],
    init(options: CrashSdkInitOptions): Promise<void> { state.inits.push(options); return Promise.resolve() },
    close(): Promise<void> { state.closes += 1; return Promise.resolve() },
    captureWindowCrash(report: WindowCrashReport): void { state.captured.push(report) }
  }
  return state
}

function consent(overrides: Partial<ConsentDecision> = {}): ConsentDecision {
  return {
    gate: 'crash',
    granted: true,
    consentedAt: null,
    policyVersion: null,
    source: 'user',
    ...overrides
  }
}

function build(overrides: {
  dsn?: string | undefined
  readConsent?: () => ConsentDecision | null
} = {}): { service: CrashReportingService; sdk: ReturnType<typeof makeSdk> } {
  const sdk = makeSdk()
  const service = new CrashReportingService({
    sdk,
    dsn: 'dsn' in overrides ? overrides.dsn : DSN,
    release: 'restorm@0.1.19',
    beforeSend: (e) => e,
    beforeBreadcrumb: (b) => b,
    readConsent: overrides.readConsent ?? ((): ConsentDecision => consent())
  })
  return { service, sdk }
}

describe('CrashReportingService — the SDK is not armed without consent', () => {
  it('does not initialise the SDK at all while consent is unanswered', async () => {
    // Not "initialised but suppressed" — never initialised. An armed SDK still
    // installs global handlers and holds a transport.
    const { service, sdk } = build({ readConsent: () => consent({ source: 'default' }) })
    const decision = await service.sync()
    expect(decision).toEqual({ init: false, reason: 'consent-unanswered' })
    expect(sdk.inits).toHaveLength(0)
    expect(service.isArmed()).toBe(false)
  })

  it('does not initialise the SDK when the user declined', async () => {
    const { service, sdk } = build({ readConsent: () => consent({ source: 'user', granted: false }) })
    expect((await service.sync()).reason).toBe('consent-declined')
    expect(sdk.inits).toHaveLength(0)
  })

  it('does not initialise the SDK without a DSN, however willing the user is', async () => {
    const { service, sdk } = build({ dsn: undefined })
    expect((await service.sync()).reason).toBe('no-dsn')
    expect(sdk.inits).toHaveLength(0)
  })

  it('initialises with the release and both scrubbing hooks once consent is granted', async () => {
    const { service, sdk } = build()
    expect((await service.sync()).reason).toBe('consent-granted')
    expect(sdk.inits).toHaveLength(1)
    expect(sdk.inits[0]?.dsn).toBe(DSN)
    expect(sdk.inits[0]?.release).toBe('restorm@0.1.19')
    // Both gates are wired — a crash reporter with only `beforeSend` still
    // ships the breadcrumb trail unscrubbed.
    expect(typeof sdk.inits[0]?.beforeSend).toBe('function')
    expect(typeof sdk.inits[0]?.beforeBreadcrumb).toBe('function')
  })

  it('arms for a plan that mandates reporting', async () => {
    const { service, sdk } = build({ readConsent: () => consent({ source: 'forced-on' }) })
    expect((await service.sync()).reason).toBe('plan-mandatory')
    expect(sdk.inits).toHaveLength(1)
  })
})

describe('CrashReportingService — withdrawal is immediate', () => {
  it('tears the SDK down as soon as consent is revoked', async () => {
    let decision = consent({ source: 'user', granted: true })
    const { service, sdk } = build({ readConsent: () => decision })
    await service.sync()
    expect(service.isArmed()).toBe(true)

    decision = consent({ source: 'user', granted: false })
    expect((await service.sync()).reason).toBe('consent-declined')
    expect(sdk.closes).toBe(1)
    expect(service.isArmed()).toBe(false)
  })

  it('re-arms if consent comes back', async () => {
    let decision = consent({ source: 'user', granted: false })
    const { service, sdk } = build({ readConsent: () => decision })
    await service.sync()
    decision = consent({ source: 'user', granted: true })
    await service.sync()
    expect(sdk.inits).toHaveLength(1)
    expect(service.isArmed()).toBe(true)
  })

  it('disarms when the plan stops permitting it, without the user touching anything', async () => {
    // e.g. a Pro subscription lapses into a plan that forbids reporting.
    let decision = consent({ source: 'user', granted: true })
    const { service, sdk } = build({ readConsent: () => decision })
    await service.sync()
    decision = consent({ source: 'forced-off', granted: false })
    expect((await service.sync()).reason).toBe('plan-forbidden')
    expect(sdk.closes).toBe(1)
  })
})

describe('CrashReportingService — reporting a renderer death', () => {
  const crash: WindowCrashReport = {
    window: 'Restorm', reason: 'oom', exitCode: 9, duringStartup: true
  }

  it('forwards the crash once armed', async () => {
    const { service, sdk } = build()
    await service.sync()
    service.reportWindowCrash(crash)
    expect(sdk.captured).toEqual([crash])
  })

  it('DROPS a crash observed while disarmed — no queue, no send-later', async () => {
    // Consent granted tomorrow is not consent for what happened today.
    const { service, sdk } = build({ readConsent: () => consent({ source: 'user', granted: false }) })
    await service.sync()
    service.reportWindowCrash(crash)
    expect(sdk.captured).toEqual([])
  })

  it('does not retroactively send a crash that happened before consent', async () => {
    let decision = consent({ source: 'default' })
    const { service, sdk } = build({ readConsent: () => decision })
    await service.sync()
    service.reportWindowCrash(crash)
    decision = consent({ source: 'user', granted: true })
    await service.sync()
    expect(sdk.captured).toEqual([])
  })
})

describe('CrashReportingService — idempotence', () => {
  it('does not re-initialise on repeated syncs with an unchanged answer', async () => {
    const { service, sdk } = build()
    await service.sync()
    await service.sync()
    await service.sync()
    expect(sdk.inits).toHaveLength(1)
    expect(sdk.closes).toBe(0)
  })

  it('does not close an SDK that was never armed', async () => {
    const { service, sdk } = build({ readConsent: () => consent({ source: 'default' }) })
    await service.sync()
    await service.sync()
    expect(sdk.closes).toBe(0)
  })

  it('survives a close that rejects, rather than wedging armed-state', async () => {
    let decision = consent({ source: 'user', granted: true })
    const sdk = makeSdk()
    sdk.close = (): Promise<void> => Promise.reject(new Error('transport hung'))
    const service = new CrashReportingService({
      sdk,
      dsn: DSN,
      release: 'r',
      beforeSend: (e) => e,
      beforeBreadcrumb: (b) => b,
      readConsent: () => decision
    })
    await service.sync()
    decision = consent({ source: 'user', granted: false })
    await expect(service.sync()).resolves.toMatchObject({ init: false })
    // Disarmed regardless: a failed flush must not leave us believing we are
    // still permitted to send.
    expect(service.isArmed()).toBe(false)
  })

  it('logs the reason on each transition', async () => {
    const log = vi.fn()
    let decision = consent({ source: 'user', granted: true })
    const service = new CrashReportingService({
      sdk: makeSdk(),
      dsn: DSN,
      release: 'r',
      beforeSend: (e) => e,
      beforeBreadcrumb: (b) => b,
      readConsent: () => decision,
      log
    })
    await service.sync()
    decision = consent({ source: 'user', granted: false })
    await service.sync()
    expect(log).toHaveBeenCalledTimes(2)
    expect(log.mock.calls[0]?.[0]).toContain('armed')
    expect(log.mock.calls[1]?.[0]).toContain('disarmed')
  })
})
