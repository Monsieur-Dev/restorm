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

/**
 * Auto-dismiss timers pause while focus is inside the toaster and must
 * resume once focus leaves — including the case where the focused control
 * is *removed* from the DOM (a toast dismissed while its close button held
 * focus). The browser fires no bubbling blur when a focused node is
 * detached, so a pause keyed on a latched flag would strand every
 * remaining toast on screen forever. Focus tracking is therefore re-derived
 * from the live active element, not latched.
 */
describe('Toaster — auto-dismiss pause never strands', () => {
  const ID = 'pause-toaster'

  // Mount the toaster, wait for it to register with the service, then run
  // `push` calls — a push before registration is dropped (returns '').
  async function mountAndPush(
    push: () => void,
    extra?: React.ReactNode
  ): Promise<HTMLElement> {
    const { getByTestId } = render(
      <>
        {extra}
        <Toaster
          id={ID}
          position="bottom-right"
          data-testid="pause-app-toaster"
          animationDurations={{ enter: 0, exit: 0, reflow: 0 }}
        />
      </>
    )
    await act(async () => { await Promise.resolve() })
    act(() => { push() })
    return waitFor(() => getByTestId('pause-app-toaster'))
  }

  const toastByTitle = (root: ParentNode, title: string): HTMLElement | null =>
    root.querySelector<HTMLElement>(`[data-toast-title="${title}"]`)

  const closeButtonOf = (root: ParentNode, title: string): HTMLElement => {
    const cell = toastByTitle(root, title)
    // ECUI Button renders a focusable `<a role="button">`, not a native
    // `<button>`; the toast's close control carries the `toast-close` class.
    const button = cell?.querySelector<HTMLElement>('.toast-close')
    if (!button) throw new Error(`no close button for toast ${title}`)
    return button
  }

  it('resumes a remaining toast after the focused toast is dismissed', async () => {
    const region = await mountAndPush(() => {
      // 'holder' never auto-dismisses (no duration); it exists only to own
      // focus and then be removed. 'timed' carries the duration we assert.
      toasterService.push(ID, { title: 'holder', body: 'h' })
      toasterService.push(ID, { title: 'timed', body: 't', durationMs: 120 })
    })
    await waitFor(() => { expect(toastByTitle(region, 'timed')).not.toBeNull() })

    // Focus the holder's close button → the whole stack pauses.
    const holderClose = closeButtonOf(region, 'holder')
    act(() => { holderClose.focus() })

    // Dismiss the holder while it holds focus: its (focused) close button is
    // detached from the DOM. No bubbling blur fires for the detached node.
    act(() => { fireEvent.click(holderClose) })
    await waitFor(() => { expect(toastByTitle(region, 'holder')).toBeNull() })

    // The timed toast must still auto-dismiss — the pause must have lifted
    // once the focused node left the DOM.
    await waitFor(
      () => { expect(toastByTitle(region, 'timed')).toBeNull() },
      { timeout: 3000 }
    )
  })

  it('resumes a toast once focus moves out of the region', async () => {
    const region = await mountAndPush(
      () => { toasterService.push(ID, { title: 'timed', body: 't', durationMs: 120 }) },
      <button data-testid="outside">outside</button>
    )
    await waitFor(() => { expect(toastByTitle(region, 'timed')).not.toBeNull() })

    const outside = document.querySelector<HTMLElement>('[data-testid="outside"]')
    if (!outside) throw new Error('missing outside button')

    // Focus inside the toaster pauses the timer…
    act(() => { closeButtonOf(region, 'timed').focus() })
    // …and moving focus to an element outside the region resumes it.
    act(() => { outside.focus() })

    await waitFor(
      () => { expect(toastByTitle(region, 'timed')).toBeNull() },
      { timeout: 3000 }
    )
  })
})
