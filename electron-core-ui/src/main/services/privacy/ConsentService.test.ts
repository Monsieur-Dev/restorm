// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { ConsentService, type ConsentSettingsPort, type ConsentStorePort } from './ConsentService'
import type { ConsentGateDefinition, ConsentOverride, PersistedConsentFile } from '../../../shared/privacy/consent'

const GATES: ConsentGateDefinition[] = [
  { id: 'crash', settingKey: 'privacy:crashReports', defaultGranted: true },
  { id: 'telemetry', settingKey: 'privacy:telemetry', defaultGranted: false }
]

/** In-memory settings store with the same change-notification contract as the
 * real one (listeners fire on `setBoolean`). */
function makeSettings(initial: Record<string, boolean> = {}): ConsentSettingsPort & {
  values: Record<string, boolean>
} {
  const values: Record<string, boolean> = { ...initial }
  const listeners = new Map<string, Set<() => void>>()
  return {
    values,
    getBoolean: (key) => values[key],
    setBoolean: (key, value) => {
      values[key] = value
      for (const l of listeners.get(key) ?? []) l()
    },
    subscribe: (key, listener) => {
      const bucket = listeners.get(key) ?? new Set()
      bucket.add(listener)
      listeners.set(key, bucket)
      return () => bucket.delete(listener)
    }
  }
}

function makeStore(initial: string | null = null): ConsentStorePort & { contents: string | null } {
  const state = {
    contents: initial,
    read: (): string | null => state.contents,
    write: (c: string): void => { state.contents = c }
  }
  return state
}

function build(overrides: {
  settings?: ConsentSettingsPort
  store?: ConsentStorePort
  resolveOverride?: (gateId: string) => ConsentOverride
} = {}): ConsentService {
  return new ConsentService({
    gates: GATES,
    settings: overrides.settings ?? makeSettings(),
    store: overrides.store ?? makeStore(),
    policyVersion: '2026-07-29',
    now: () => new Date('2026-07-29T10:00:00.000Z'),
    ...(overrides.resolveOverride ? { resolveOverride: overrides.resolveOverride } : {})
  })
}

function persisted(store: { contents: string | null }): PersistedConsentFile {
  return JSON.parse(store.contents ?? '{}') as PersistedConsentFile
}

describe('ConsentService — defaults', () => {
  it('answers from the declared default when nothing was ever stored', () => {
    const service = build()
    expect(service.canSend('crash')).toBe(true)
    expect(service.canSend('telemetry')).toBe(false)
  })

  it('reports source "default" and no audit trail until someone decides', () => {
    const store = makeStore()
    const service = build({ store })
    expect(service.getDecision('telemetry')).toEqual({
      gate: 'telemetry',
      granted: false,
      consentedAt: null,
      policyVersion: null,
      source: 'default'
    })
    // Nothing was recorded — an untouched default is not a consent decision.
    expect(store.contents).toBeNull()
  })

  it('fails closed for an unknown gate', () => {
    const service = build()
    expect(service.canSend('nope')).toBe(false)
    expect(service.getDecision('nope')).toBeNull()
  })
})

describe('ConsentService — recording and revocation', () => {
  it('stamps value, timestamp and policy version when a gate is granted', () => {
    const store = makeStore()
    const service = build({ store })
    service.setGranted('telemetry', true)
    expect(service.canSend('telemetry')).toBe(true)
    expect(persisted(store).gates['telemetry']).toEqual({
      granted: true,
      consentedAt: '2026-07-29T10:00:00.000Z',
      policyVersion: '2026-07-29'
    })
    expect(service.getDecision('telemetry')?.source).toBe('user')
  })

  it('records a revocation as an audited decision, not as an absence', () => {
    const store = makeStore()
    const service = build({ store })
    service.setGranted('telemetry', true)
    service.revoke('telemetry')
    expect(service.canSend('telemetry')).toBe(false)
    expect(persisted(store).gates['telemetry']?.granted).toBe(false)
  })

  it('follows the settings toggle when the user flips it in Preferences', () => {
    const settings = makeSettings()
    const store = makeStore()
    const service = build({ settings, store })
    settings.setBoolean('privacy:telemetry', true)
    expect(service.canSend('telemetry')).toBe(true)
    expect(persisted(store).gates['telemetry']?.granted).toBe(true)
  })

  it('notifies subscribers on every consent transition', () => {
    const settings = makeSettings()
    const service = build({ settings })
    const seen = vi.fn()
    service.onChange(seen)
    settings.setBoolean('privacy:telemetry', true)
    expect(seen).toHaveBeenCalledTimes(1)
    expect(seen.mock.calls[0]?.[0]).toContainEqual(expect.objectContaining({ gate: 'telemetry', granted: true }))
  })

  it('stops following the toggle after dispose', () => {
    const settings = makeSettings()
    const service = build({ settings })
    const seen = vi.fn()
    service.onChange(seen)
    service.dispose()
    settings.setBoolean('privacy:telemetry', true)
    expect(seen).not.toHaveBeenCalled()
  })
})

describe('ConsentService — persistence', () => {
  it('restores the audit trail from disk', () => {
    const store = makeStore(JSON.stringify({
      version: 1,
      gates: { telemetry: { granted: true, consentedAt: '2026-01-01T00:00:00.000Z', policyVersion: '2026-01-01' } }
    }))
    const service = build({ settings: makeSettings({ 'privacy:telemetry': true }), store })
    expect(service.getDecision('telemetry')).toMatchObject({
      granted: true,
      consentedAt: '2026-01-01T00:00:00.000Z',
      policyVersion: '2026-01-01'
    })
  })

  it('does NOT re-stamp an unchanged value when the policy version moved', () => {
    // Leaving the stale version visible is what lets a host detect "consented
    // to older terms" and re-ask, instead of laundering old consent forward.
    const store = makeStore(JSON.stringify({
      version: 1,
      gates: { telemetry: { granted: true, consentedAt: '2026-01-01T00:00:00.000Z', policyVersion: '2026-01-01' } }
    }))
    build({ settings: makeSettings({ 'privacy:telemetry': true }), store })
    expect(persisted(store).gates['telemetry']?.policyVersion).toBe('2026-01-01')
  })

  it('catches up at boot when the stored boolean drifted from the default', () => {
    // e.g. a settings.json edited by hand, or restored from a backup.
    const store = makeStore()
    const service = build({ settings: makeSettings({ 'privacy:telemetry': true }), store })
    expect(persisted(store).gates['telemetry']).toMatchObject({ granted: true })
    expect(service.getDecision('telemetry')?.source).toBe('user')
  })

  it('starts a fresh trail on an unreadable file rather than throwing', () => {
    const service = build({ store: makeStore('{ not json') })
    expect(service.canSend('telemetry')).toBe(false)
  })

  it('drops malformed entries instead of trusting them', () => {
    const store = makeStore(JSON.stringify({
      version: 1,
      gates: { telemetry: { granted: 'yes', consentedAt: 5 } }
    }))
    const service = build({ store })
    expect(service.getDecision('telemetry')?.consentedAt).toBeNull()
  })
})

describe('ConsentService — host overrides', () => {
  it('forces a gate on regardless of the stored boolean', () => {
    const settings = makeSettings({ 'privacy:crashReports': false })
    const service = build({ settings, resolveOverride: (g) => (g === 'crash' ? 'forced-on' : null) })
    expect(service.canSend('crash')).toBe(true)
    expect(service.getDecision('crash')?.source).toBe('forced-on')
  })

  it('forces a gate off regardless of the stored boolean', () => {
    const settings = makeSettings({ 'privacy:telemetry': true })
    const service = build({ settings, resolveOverride: (g) => (g === 'telemetry' ? 'forced-off' : null) })
    expect(service.canSend('telemetry')).toBe(false)
    expect(service.getDecision('telemetry')?.source).toBe('forced-off')
  })

  it('re-reads the override on every resolution, so a live plan change takes effect', () => {
    let plan = 'community'
    const settings = makeSettings({ 'privacy:crashReports': false })
    const service = build({
      settings,
      resolveOverride: (g) => (g === 'crash' && plan === 'community' ? 'forced-on' : null)
    })
    expect(service.canSend('crash')).toBe(true)
    plan = 'pro'
    expect(service.canSend('crash')).toBe(false)
  })

  it('never writes the override into the audit trail — it records what the USER chose', () => {
    const store = makeStore()
    const settings = makeSettings()
    const service = build({ settings, store, resolveOverride: () => 'forced-on' })
    service.setGranted('telemetry', false)
    expect(service.canSend('telemetry')).toBe(true)
    expect(persisted(store).gates['telemetry']?.granted).toBe(false)
  })
})

describe('ConsentService — answering without changing the value', () => {
  it('records an answer that matches the value already stored', () => {
    // The case a consent prompt actually hits: the checkbox is pre-checked from
    // the default, so the commonest answer changes no value at all. If that did
    // not stamp the trail the gate would stay "nobody decided" and the prompt
    // would return on every launch, however many times it was answered.
    const settings = makeSettings()
    const store = makeStore()
    const service = new ConsentService({
      gates: GATES,
      settings,
      store,
      policyVersion: '2026-07-29',
      now: () => new Date('2026-07-29T10:00:00.000Z')
    })

    expect(service.getDecision('crash')?.source).toBe('default')
    expect(service.getDecision('crash')?.consentedAt).toBeNull()

    service.setGranted('crash', true) // same as the default — no value moves

    const decision = service.getDecision('crash')
    expect(decision?.source).toBe('user')
    expect(decision?.granted).toBe(true)
    expect(decision?.consentedAt).toBe('2026-07-29T10:00:00.000Z')
    expect(persisted(store).gates['crash']?.granted).toBe(true)
  })

  it('lets a plan-mandated account express a preference without escaping the mandate', () => {
    // A Community client may call the consent write; it must record the choice
    // and still resolve to granted, because the override is applied after the
    // stored value. The stored `false` is preserved for when the plan lifts.
    const settings = makeSettings()
    const service = build({
      settings,
      resolveOverride: (gateId) => (gateId === 'crash' ? 'forced-on' : null)
    })

    service.setGranted('crash', false)

    expect(service.canSend('crash')).toBe(true)
    expect(service.getDecision('crash')?.source).toBe('forced-on')
    expect(settings.values['privacy:crashReports']).toBe(false)
  })
})

describe('ConsentService — revalidate', () => {
  it('announces a new answer when only the override moved', () => {
    // A plan transition changes `resolveOverride`'s answer without touching a
    // setting, so nothing else would ever tell subscribers to re-read it.
    let plan: ConsentOverride = 'forced-on'
    const service = build({ resolveOverride: (gateId) => (gateId === 'crash' ? plan : null) })
    const listener = vi.fn()
    service.onChange(listener)

    plan = null
    service.revalidate()

    expect(listener).toHaveBeenCalledTimes(1)
    const decisions = listener.mock.calls[0]?.[0] as { gate: string; source: string }[]
    expect(decisions.find((d) => d.gate === 'crash')?.source).toBe('default')
  })
})
