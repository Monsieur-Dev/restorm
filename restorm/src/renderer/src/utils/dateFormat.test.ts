import { describe, it, expect } from 'vitest'
import { formatUserDate } from './dateFormat'

describe('formatUserDate', () => {
  const date = new Date(2026, 6, 23, 9, 5, 3) // 2026-07-23 09:05:03 local

  it('formats full date+time in "iso" mode as YYYY-MM-DD HH:mm:ss', () => {
    expect(formatUserDate(date, 'iso', 'en-US')).toBe('2026-07-23 09:05:03')
  })

  it('formats full date+time in "us" mode via Intl.DateTimeFormat', () => {
    const expected = new Intl.DateTimeFormat('en-US', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(date)
    expect(formatUserDate(date, 'us', 'en-US')).toBe(expected)
  })

  it('formats time-only in "iso" mode as HH:mm:ss', () => {
    expect(formatUserDate(date, 'iso', 'en-US', { timeOnly: true })).toBe('09:05:03')
  })

  it('formats time-only in "us" mode via Intl.DateTimeFormat', () => {
    const expected = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(date)
    expect(formatUserDate(date, 'us', 'en-US', { timeOnly: true })).toBe(expected)
  })

  it('pads single-digit date/time components in "iso" mode', () => {
    const single = new Date(2026, 0, 5, 1, 2, 3) // 2026-01-05 01:02:03
    expect(formatUserDate(single, 'iso', 'en-US')).toBe('2026-01-05 01:02:03')
  })
})
