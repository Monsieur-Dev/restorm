// @vitest-environment jsdom
/**
 * Keyboard-dismiss behaviour for the framed toaster panel: opening the
 * frame (as a bell/tray trigger does) and pressing Escape must hide the
 * panel — the same effect as the header "Hide" action — and hand focus
 * back to whatever opened it, matching the app's other overlays (Modal,
 * MenuBar). Without this the panel could only be closed by re-clicking
 * the trigger or the Hide button, stranding keyboard users.
 */
import React from 'react'
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { Toaster } from './Toaster'
import { toasterService } from './ToasterService'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

// jsdom ships no ResizeObserver; the toaster's ScrollableElement child
// constructs one on mount. A no-op stub lets the tree render.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe(): void { /* no-op */ }
    unobserve(): void { /* no-op */ }
    disconnect(): void { /* no-op */ }
  } as unknown as typeof ResizeObserver
})

afterEach(() => {
  cleanup()
  toasterService._reset()
})

const TOASTER_ID = 'test-toaster'

function Harness(): React.JSX.Element {
  return (
    <>
      <button
        data-testid="trigger"
        onClick={() => { toasterService.toggleVisibility(TOASTER_ID) }}
      >
        Bell
      </button>
      <Toaster id={TOASTER_ID} position="bottom-right" data-testid="app-toaster" />
    </>
  )
}

/**
 * Open the frame via the KEYBOARD path: focus the trigger (as Tab would),
 * then activate it. A native button keeps focus on itself through
 * activation, so `document.activeElement` IS the trigger at open time —
 * the precondition for the focus-return assertion. (jsdom doesn't
 * synthesize a click from an Enter keydown, so we fire the activation the
 * Harness's `onClick` listens for; the load-bearing part is that focus
 * already sits on the trigger, exactly as after Enter/Space.)
 */
async function openPanel(getByTestId: (id: string) => HTMLElement): Promise<void> {
  const trigger = getByTestId('trigger')
  trigger.focus()
  expect(document.activeElement).toBe(trigger)
  fireEvent.click(trigger)
  await waitFor(() => getByTestId('app-toaster'))
  expect(toasterService.getShowFrame(TOASTER_ID)).toBe(true)
}

describe('Toaster — Escape dismiss', () => {
  it('closes the framed panel on Escape', async () => {
    const { getByTestId, queryByTestId } = render(<Harness />)
    await openPanel(getByTestId)

    act(() => { fireEvent.keyDown(document.body, { key: 'Escape' }) })

    expect(toasterService.getShowFrame(TOASTER_ID)).toBe(false)
    await waitFor(() => { expect(queryByTestId('app-toaster')).toBeNull() })
  })

  it('returns focus to the trigger after Escape-close', async () => {
    const { getByTestId } = render(<Harness />)
    await openPanel(getByTestId)

    act(() => { fireEvent.keyDown(document.body, { key: 'Escape' }) })

    expect(document.activeElement).toBe(getByTestId('trigger'))
  })

  it('ignores non-Escape keys while the panel is open', async () => {
    const { getByTestId } = render(<Harness />)
    await openPanel(getByTestId)

    act(() => { fireEvent.keyDown(document.body, { key: 'Enter' }) })

    expect(toasterService.getShowFrame(TOASTER_ID)).toBe(true)
  })

  it('does not intercept Escape once the panel is closed', async () => {
    const { getByTestId } = render(<Harness />)
    await openPanel(getByTestId)

    // Close via Escape, then refocus the trigger and press Escape again:
    // with no frame open the second Escape must be a no-op (the listener
    // is unregistered), leaving focus untouched.
    act(() => { fireEvent.keyDown(document.body, { key: 'Escape' }) })
    expect(toasterService.getShowFrame(TOASTER_ID)).toBe(false)

    const trigger = getByTestId('trigger')
    trigger.focus()
    act(() => { fireEvent.keyDown(document.body, { key: 'Escape' }) })
    expect(document.activeElement).toBe(trigger)
    expect(toasterService.getShowFrame(TOASTER_ID)).toBe(false)
  })
})
