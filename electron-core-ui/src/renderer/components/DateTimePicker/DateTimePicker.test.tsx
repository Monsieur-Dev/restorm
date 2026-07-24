// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup, act } from '@testing-library/react'

// monaco-editor is pulled in transitively by a sibling barrel and touches a
// couple of APIs jsdom doesn't implement at module load. Shim them before the
// component import runs (vi.hoisted executes before static imports).
vi.hoisted(() => {
  if (typeof document !== 'undefined') {
    const doc = document as unknown as { queryCommandSupported?: () => boolean }
    doc.queryCommandSupported = doc.queryCommandSupported ?? (() => false)
  }
})

// No i18n instance in the test harness — echo the key/fallback.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { resolvedLanguage: 'en', language: 'en', changeLanguage: () => Promise.resolve() }
  })
}))

import DateTimePicker from './DateTimePicker'

afterEach(() => {
  cleanup()
})

describe('DateTimePicker outside-click dismiss', () => {
  it('closes when an outside element swallows the mousedown in the bubble phase', () => {
    const { getByTestId } = render(
      <DateTimePicker value={new Date(2024, 0, 15)} onChange={vi.fn()} />
    )
    const root = getByTestId('datetimepicker')

    // Open the calendar.
    fireEvent.click(getByTestId('datetimepicker-open'))
    expect(root.getAttribute('data-is-open')).toBe('true')

    // Simulate a host (e.g. a graph/canvas pane) that captures pointer
    // gestures and stops propagation on mousedown in the bubble phase — a
    // bubble-phase document listener would never see this click. The dismiss
    // must still fire because it listens in the capture phase.
    const pane = document.createElement('div')
    document.body.appendChild(pane)
    pane.addEventListener('mousedown', (e) => { e.stopPropagation() })

    fireEvent.mouseDown(pane)

    expect(root.getAttribute('data-is-open')).toBe('false')

    pane.remove()
  })

  it('stays open when the mousedown is inside the calendar popover', () => {
    const { getByTestId } = render(
      <DateTimePicker value={new Date(2024, 0, 15)} onChange={vi.fn()} />
    )
    const root = getByTestId('datetimepicker')

    fireEvent.click(getByTestId('datetimepicker-open'))
    expect(root.getAttribute('data-is-open')).toBe('true')

    // A click landing inside the calendar must not dismiss it.
    fireEvent.mouseDown(getByTestId('datetimepicker-popover-content'))

    expect(root.getAttribute('data-is-open')).toBe('true')
  })
})

describe('DateTimePicker typed input', () => {
  it('parses a complete typed date and commits it via onChange', () => {
    vi.useFakeTimers()
    try {
      const onChange = vi.fn()
      const { getByTestId } = render(
        <DateTimePicker value={new Date(2024, 0, 15, 10, 30, 0)} onChange={onChange} />
      )
      // InputBox debounces, so flush after the change.
      fireEvent.change(getByTestId('datetimepicker-input-input'), { target: { value: '2025-03-09 08:45:00' } })
      act(() => { vi.advanceTimersByTime(500) })

      expect(onChange).toHaveBeenCalledTimes(1)
      const committed = onChange.mock.calls[0]?.[0] as Date
      expect(committed.getFullYear()).toBe(2025)
      expect(committed.getMonth()).toBe(2) // March (0-based)
      expect(committed.getDate()).toBe(9)
      expect(committed.getHours()).toBe(8)
    } finally {
      vi.useRealTimers()
    }
  })

  it('flags an invalid typed date with aria-invalid (red border) and clears it when valid again', () => {
    const { getByTestId } = render(
      <DateTimePicker value={new Date(2024, 0, 15, 10, 30, 0)} onChange={vi.fn()} />
    )
    const input = getByTestId('datetimepicker-input-input')
    fireEvent.change(input, { target: { value: 'not a date' } })
    expect(input.getAttribute('aria-invalid')).toBe('true')

    fireEvent.change(input, { target: { value: '2025-03-09 08:45:00' } })
    expect(input.getAttribute('aria-invalid')).not.toBe('true')

    // An empty field is neutral, not an error.
    fireEvent.change(input, { target: { value: '' } })
    expect(input.getAttribute('aria-invalid')).not.toBe('true')
  })

  it('does NOT commit an incomplete / invalid typed date', () => {
    vi.useFakeTimers()
    try {
      const onChange = vi.fn()
      const { getByTestId } = render(
        <DateTimePicker value={new Date(2024, 0, 15, 10, 30, 0)} onChange={onChange} />
      )
      fireEvent.change(getByTestId('datetimepicker-input-input'), { target: { value: '2025-03' } })
      act(() => { vi.advanceTimersByTime(500) })

      expect(onChange).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('falls back to flexible parsing — an epoch number or ISO string commits even in pattern mode', () => {
    vi.useFakeTimers()
    try {
      const onChange = vi.fn()
      const { getByTestId } = render(
        // Default mode is the `yyyy-MM-dd HH:mm:ss` pattern — neither an epoch
        // number nor an ISO 8601 string matches it, but both must still commit.
        <DateTimePicker value={new Date(2024, 0, 15, 10, 30, 0)} onChange={onChange} />
      )
      const input = getByTestId('datetimepicker-input-input')

      // JS milliseconds epoch (≥ 1e12).
      fireEvent.change(input, { target: { value: '1717520102000' } })
      act(() => { vi.advanceTimersByTime(500) })
      // Unix seconds epoch (< 1e12) → SAME instant.
      fireEvent.change(input, { target: { value: '1717520102' } })
      act(() => { vi.advanceTimersByTime(500) })
      // ISO 8601 string.
      fireEvent.change(input, { target: { value: '2025-03-09T08:45:00Z' } })
      act(() => { vi.advanceTimersByTime(500) })

      expect(onChange).toHaveBeenCalledTimes(3)
      const ms = onChange.mock.calls[0]?.[0] as Date
      const secs = onChange.mock.calls[1]?.[0] as Date
      const iso = onChange.mock.calls[2]?.[0] as Date
      expect(ms.getTime()).toBe(1717520102000)
      expect(secs.getTime()).toBe(1717520102000)
      expect(iso.getUTCFullYear()).toBe(2025)
      expect(iso.getUTCHours()).toBe(8)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('DateTimePicker include-time toggle', () => {
  // Regression coverage: toggling "include time" used to rewrite the pattern
  // with 'YYYY-MM-DD HH:mm:ss' / 'YYYY-MM-DD' — invalid luxon tokens (`YYYY`
  // leaks verbatim, `DD` is a localized date, not "day"). This pattern is what
  // gets SENT as the value's wire format, so the displayed value must never
  // carry either artifact.
  const brokenTokenPattern = /YYYY|(?<![a-zA-Z])DD(?![a-zA-Z])/

  it('toggling ON then OFF then ON again keeps a valid lowercase pattern in both directions', () => {
    const { getByTestId } = render(
      <DateTimePicker value={new Date(2026, 6, 23, 16, 11, 51)} onChange={vi.fn()} />
    )
    fireEvent.click(getByTestId('datetimepicker-open'))
    const input = getByTestId('datetimepicker-input-input') as HTMLInputElement

    // Default pattern already carries time tokens, so this first toggle ON is
    // a no-op on the pattern — it doesn't exercise line 312 (the ON-direction
    // rewrite) at all.
    fireEvent.click(getByTestId('datetimepicker-include-time'))
    expect(input.value).not.toMatch(brokenTokenPattern)

    // Toggling OFF is what used to trip the broken 'YYYY-MM-DD' literal.
    fireEvent.click(getByTestId('datetimepicker-include-time'))
    expect(input.value).not.toMatch(brokenTokenPattern)
    expect(input.value).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    // The pattern is now time-less, so toggling ON again exercises the OTHER
    // rewrite — line 312's 'YYYY-MM-DD HH:mm:ss' literal — which the two
    // assertions above never reach.
    fireEvent.click(getByTestId('datetimepicker-include-time'))
    expect(input.value).not.toMatch(brokenTokenPattern)
    expect(input.value).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })
})
