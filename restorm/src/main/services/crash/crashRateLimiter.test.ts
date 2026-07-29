import { describe, it, expect } from 'vitest'
import { CrashRateLimiter, DEFAULT_CRASH_RATE_LIMITS, type CrashRateLimitConfig } from './crashRateLimiter'

/** A limiter over a clock the test drives. */
function build(
  config: Partial<CrashRateLimitConfig> = {},
  random = (): number => 0
): { limiter: CrashRateLimiter; advance: (ms: number) => void } {
  let clock = 1_000_000
  const limiter = new CrashRateLimiter({ config, now: () => clock, random })
  return {
    limiter,
    advance: (ms: number): void => { clock += ms }
  }
}

describe('CrashRateLimiter — dedup', () => {
  it('sends the first sighting of a failure', () => {
    const { limiter } = build()
    expect(limiter.check('TypeError@render')).toBe('send')
  })

  it('holds back the same failure seen again inside the dedup window', () => {
    const { limiter } = build()
    limiter.check('TypeError@render')
    expect(limiter.check('TypeError@render')).toBe('duplicate')
  })

  it('reports the same failure again once the dedup window has passed', () => {
    // A fault that recurs an hour later is news, not noise.
    const { limiter, advance } = build()
    limiter.check('TypeError@render')
    advance(DEFAULT_CRASH_RATE_LIMITS.dedupeWindowMs + 1)
    expect(limiter.check('TypeError@render')).toBe('send')
  })

  it('does not confuse two different failures', () => {
    const { limiter } = build()
    expect(limiter.check('TypeError@render')).toBe('send')
    expect(limiter.check('RangeError@parse')).toBe('send')
  })

  it('does NOT let a duplicate consume the session budget', () => {
    // The point of dedup: a looping fault costs one report, not all of them.
    // If duplicates spent the allowance, one loop would silence every other
    // fault for the rest of the session — exactly backwards.
    const { limiter } = build({ maxPerSession: 3, maxPerWindow: 100 })
    for (let i = 0; i < 50; i++) limiter.check('TypeError@loop')
    expect(limiter.sentCount()).toBe(1)
    expect(limiter.check('RangeError@other')).toBe('send')
  })
})

describe('CrashRateLimiter — caps', () => {
  it('flattens a burst with the rolling window', () => {
    const { limiter } = build({ maxPerWindow: 3, windowMs: 60_000, maxPerSession: 100 })
    expect(limiter.check('a@1')).toBe('send')
    expect(limiter.check('b@2')).toBe('send')
    expect(limiter.check('c@3')).toBe('send')
    expect(limiter.check('d@4')).toBe('rate-limited')
  })

  it('lets the window roll forward rather than latching', () => {
    const { limiter, advance } = build({ maxPerWindow: 2, windowMs: 60_000, maxPerSession: 100 })
    limiter.check('a@1')
    limiter.check('b@2')
    expect(limiter.check('c@3')).toBe('rate-limited')
    advance(60_001)
    expect(limiter.check('d@4')).toBe('send')
  })

  it('stops at the session cap however long the app runs', () => {
    const { limiter, advance } = build({ maxPerSession: 2, maxPerWindow: 100 })
    expect(limiter.check('a@1')).toBe('send')
    expect(limiter.check('b@2')).toBe('send')
    advance(24 * 60 * 60 * 1000)
    expect(limiter.check('c@3')).toBe('session-cap')
  })
})

describe('CrashRateLimiter — sampling', () => {
  it('is inactive by default, so a distinct crash is never thrown away at random', () => {
    // A rare bug seen once is the most valuable report there is; sampling is
    // the one rule that could discard it, so it ships off.
    const { limiter } = build({}, () => 0.999999)
    expect(limiter.check('rare@bug')).toBe('send')
  })

  it('discards at the configured rate once dialled down', () => {
    const { limiter } = build({ sampleRate: 0.5 }, () => 0.9)
    expect(limiter.check('a@1')).toBe('sampled-out')
  })

  it('keeps what falls under the rate', () => {
    const { limiter } = build({ sampleRate: 0.5 }, () => 0.1)
    expect(limiter.check('a@1')).toBe('send')
  })

  it('does not spend the budget on a report it sampled out', () => {
    const { limiter } = build({ sampleRate: 0.5, maxPerSession: 5 }, () => 0.9)
    limiter.check('a@1')
    expect(limiter.sentCount()).toBe(0)
  })
})

describe('CrashRateLimiter — synthetic flood', () => {
  it('caps a runaway loop, and the cap holds', () => {
    // The scenario the quota has to survive: one bug firing continuously for an
    // hour of wall-clock time.
    const { limiter, advance } = build()
    let sent = 0
    for (let i = 0; i < 5000; i++) {
      if (limiter.check('TypeError@hotLoop') === 'send') sent += 1
      advance(720) // ~1 h across the whole flood
    }
    // Bounded by dedup, not by the session cap — one fault, reported now and
    // then, never 5000 times.
    expect(sent).toBeLessThanOrEqual(DEFAULT_CRASH_RATE_LIMITS.maxPerSession)
    expect(sent).toBeGreaterThan(0)
  })

  it('still reports the FIRST sighting of each distinct fault during a flood', () => {
    // The assertion that separates a useful limiter from a merely quiet one. A
    // limiter that bounded volume by dropping every new fault's first sighting
    // would pass a count-only check and be worse than useless: the flood would
    // hide precisely the new information.
    const { limiter, advance } = build({ maxPerSession: 100, maxPerWindow: 100 })
    const seen: string[] = []
    for (let i = 0; i < 300; i++) {
      // A hot loop hammering throughout, with a genuinely new fault every 100.
      if (limiter.check('TypeError@hotLoop') === 'send') seen.push('hotLoop')
      if (i % 100 === 0 && limiter.check(`Distinct@fault${String(i)}`) === 'send') {
        seen.push(`fault${String(i)}`)
      }
      advance(1000)
    }
    expect(seen).toContain('fault0')
    expect(seen).toContain('fault100')
    expect(seen).toContain('fault200')
  })

  it('never exceeds the session cap no matter how many distinct faults arrive', () => {
    const { limiter, advance } = build({ maxPerSession: 10, maxPerWindow: 100 })
    let sent = 0
    for (let i = 0; i < 1000; i++) {
      if (limiter.check(`Distinct@fault${String(i)}`) === 'send') sent += 1
      advance(10_000)
    }
    expect(sent).toBe(10)
  })
})
