import { describe, it, expect } from 'vitest'
import { applyDateTime, isDateTimeOp, isDateTimeUnit, DATETIME_OPS } from './scenarioDateTime'

describe('scenarioDateTime — the one date-math core (runtime + preview)', () => {
  it('add / subtract shift by amount + unit (ISO out)', () => {
    expect(applyDateTime('2026-01-01T00:00:00.000Z', 'add', { amount: 2, unit: 'days' })).toContain('2026-01-03')
    expect(applyDateTime('2026-01-01T00:00:00.000Z', 'subtract', { amount: 1, unit: 'hours' })).toContain(
      '2025-12-31'
    )
    expect(applyDateTime('2026-01-31T00:00:00.000Z', 'add', { amount: 1, unit: 'months' })).toContain('2026-02-28')
  })

  it('add accepts an epoch number input', () => {
    // 1_700_000_000 s = 2023-11-14T22:13:20Z; +1 day
    const out = applyDateTime(1_700_000_000, 'add', { amount: 1, unit: 'days' })
    expect(out).toContain('2023-11-15')
  })

  it('format renders a luxon pattern; empty pattern → ISO', () => {
    expect(applyDateTime('2026-06-05T08:09:10.000Z', 'format', { format: 'yyyy-LL-dd' })).toBe('2026-06-05')
    expect(applyDateTime('2026-06-05T00:00:00.000Z', 'format', {})).toContain('2026-06-05')
  })

  it('diff returns other − value in the given unit (signed number)', () => {
    expect(
      applyDateTime('2026-01-01T00:00:00.000Z', 'diff', { other: '2026-01-11T00:00:00.000Z', unit: 'days' })
    ).toBe(10)
    expect(
      applyDateTime('2026-01-11T00:00:00.000Z', 'diff', { other: '2026-01-01T00:00:00.000Z', unit: 'days' })
    ).toBe(-10)
  })

  it('an unparseable value (or diff other) THROWS (→ error port)', () => {
    expect(() => applyDateTime('not a date', 'add', { amount: 1, unit: 'days' })).toThrow(/date/)
    expect(() => applyDateTime('2026-01-01', 'diff', { other: 'nope', unit: 'days' })).toThrow(/date/)
  })

  it('op + unit guards', () => {
    expect(DATETIME_OPS).toContain('diff')
    expect(isDateTimeOp('format')).toBe(true)
    expect(isDateTimeOp('parse')).toBe(false)
    expect(isDateTimeUnit('hours')).toBe(true)
    expect(isDateTimeUnit('fortnights')).toBe(false)
  })
})
