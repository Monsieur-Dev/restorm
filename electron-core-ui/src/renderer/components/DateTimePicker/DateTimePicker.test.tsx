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
})
