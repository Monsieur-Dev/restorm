// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'

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
