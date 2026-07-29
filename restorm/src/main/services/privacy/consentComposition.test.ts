import { describe, it, expect } from 'vitest'
import { crashOverrideFor, type ResolvedPlan } from './consentComposition'

/**
 * The plan-modulation rule is the whole reason crash consent differs from
 * telemetry consent, so it gets its own test at the seam where Restorm's policy
 * lives — the generic override machinery is covered in `ConsentService.test.ts`.
 */
describe('crashOverrideFor', () => {
  it('forces crash reporting ON for Community — the free tier cannot opt out', () => {
    expect(crashOverrideFor('crash', 'community')).toBe('forced-on')
  })

  it('leaves the stored choice alone on every paid plan', () => {
    expect(crashOverrideFor('crash', 'pro')).toBeNull()
    expect(crashOverrideFor('crash', 'enterprise')).toBeNull()
  })

  it('forces nothing while the plan is still unknown', () => {
    // The boot window before the cached session loads. Reading it as
    // `community` would force reporting on for a Pro user who had opted out —
    // a real send they refused, caused by transient ignorance.
    expect(crashOverrideFor('crash', 'unknown')).toBeNull()
  })

  it('never touches telemetry, whatever the plan', () => {
    const plans: ResolvedPlan[] = ['community', 'pro', 'enterprise', 'unknown']
    for (const plan of plans) {
      expect(crashOverrideFor('telemetry', plan)).toBeNull()
    }
  })

  it('never touches a gate it does not know', () => {
    expect(crashOverrideFor('feedback', 'community')).toBeNull()
  })
})
