// @vitest-environment jsdom
/**
 * Regression test for the Modal focus-management effect bailing out on the
 * very render where `isOpen` flips true: the dialog hasn't mounted yet on
 * that pass (`isRendered` only catches up a frame later via the open/close
 * orchestration effect), so `dialogRef.current` was still null and the
 * effect returned early — silently skipping the initial focus, the Tab
 * trap, AND the close-time restore (whose cleanup never got registered).
 * These tests drive the component through a real open/close cycle (no
 * mocked timers, since the mount sequence relies on real
 * `requestAnimationFrame` frames) and assert the three behaviours land.
 *
 * Also covers `trapFocus={false}`: consumers that reuse `Modal` as a
 * maximize-style wrapper around pre-existing content (a workbench tab's
 * maximize view, `Tabs`'s own `allowFullscreen`) must NOT get autofocus,
 * the Tab trap, or focus-restore — the content isn't a dialog the user
 * "enters", so its existing focus must survive untouched.
 */
import { useState } from 'react'
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { Modal } from './Modal'

// jsdom has no layout engine, so `offsetParent` (the Tab trap's "is this
// element actually visible" check) always reads null regardless of the
// element's real display state. Stub it to a non-null sentinel so the trap's
// visibility filter behaves like it does in a real, laid-out browser window.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    get(): Element | null { return document.body },
    configurable: true
  })
})

afterEach(() => { cleanup() })

function Harness(): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  return (
    <>
      <button data-testid="trigger" onClick={() => { setIsOpen(true) }}>Open</button>
      <Modal isOpen={isOpen} onClose={() => { setIsOpen(false) }} title="Test modal">
        <button data-testid="child-a">A</button>
        <button data-testid="child-b">B</button>
      </Modal>
    </>
  )
}

describe('Modal — focus management', () => {
  it('moves focus into the dialog on open', async () => {
    const { getByTestId } = render(<Harness />)
    fireEvent.click(getByTestId('trigger'))

    await waitFor(() => getByTestId('modal'))
    // The close button is the first focusable element in DOM order (header
    // precedes body), so it's the one that should receive the initial focus.
    await waitFor(() => {
      expect(document.activeElement).toBe(getByTestId('modal-close'))
    })
  })

  it('traps Tab, wrapping last→first and first→last', async () => {
    const { getByTestId } = render(<Harness />)
    fireEvent.click(getByTestId('trigger'))
    await waitFor(() => getByTestId('modal'))

    const closeButton = getByTestId('modal-close')
    const childB = getByTestId('child-b')

    // Forward from the last focusable wraps to the first.
    childB.focus()
    fireEvent.keyDown(childB, { key: 'Tab' })
    expect(document.activeElement).toBe(closeButton)

    // Backward (Shift+Tab) from the first focusable wraps to the last.
    fireEvent.keyDown(closeButton, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(childB)
  })

  it('restores focus to the trigger on close', async () => {
    const { getByTestId } = render(<Harness />)
    const trigger = getByTestId('trigger')
    trigger.focus()
    fireEvent.click(trigger)

    await waitFor(() => getByTestId('modal'))
    await waitFor(() => {
      expect(document.activeElement).toBe(getByTestId('modal-close'))
    })

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger)
    })
  })

  it('does not autofocus, trap Tab, or restore focus when trapFocus is false', async () => {
    function OptOutHarness(): React.JSX.Element {
      const [isOpen, setIsOpen] = useState(false)
      return (
        <>
          <button data-testid="trigger" onClick={() => { setIsOpen(true) }}>Open</button>
          <Modal isOpen={isOpen} onClose={() => { setIsOpen(false) }} title="Test modal" trapFocus={false}>
            <button data-testid="child-a">A</button>
            <button data-testid="child-b">B</button>
          </Modal>
        </>
      )
    }

    const { getByTestId } = render(<OptOutHarness />)
    const trigger = getByTestId('trigger')
    trigger.focus()
    fireEvent.click(trigger)
    await waitFor(() => getByTestId('modal'))

    // Focus stayed on the trigger — no autofocus into the dialog.
    expect(document.activeElement).toBe(trigger)

    // Tab is not trapped: the keydown on the last focusable child is left
    // alone (no `preventDefault`/wrap), so nothing forces focus to the
    // close button.
    const childB = getByTestId('child-b')
    childB.focus()
    fireEvent.keyDown(childB, { key: 'Tab' })
    expect(document.activeElement).toBe(childB)

    // Escape still closes (a separate, unconditional listener) but does
    // not restore focus anywhere, since no restore effect was registered.
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => {
      expect(getByTestId('trigger')).toBeTruthy()
    })
    expect(document.activeElement).toBe(childB)
  })
})

describe('closing without a transition', () => {
  it('tears the overlay down even when transitionend never fires', async () => {
    // jsdom runs no CSS transitions, so this is exactly the stranded case:
    // an overlay left mounted at opacity 0 still swallows every click in
    // the window — the app looks alive and answers nothing.
    const onClosed = vi.fn()
    const { rerender, queryByTestId } = render(
      <Modal isOpen title="t" onClose={vi.fn()} onClosed={onClosed} data-testid="m">body</Modal>
    )
    expect(queryByTestId('m')).toBeTruthy()

    rerender(<Modal isOpen={false} title="t" onClose={vi.fn()} onClosed={onClosed} data-testid="m">body</Modal>)

    await waitFor(() => { expect(onClosed).toHaveBeenCalled() }, { timeout: 2000 })
    expect(queryByTestId('m')).toBeNull()
  })
})

describe('Modal — Enter default action (enterActionTestId)', () => {
  function EnterHarness({ withTextarea = false, disabledOk = false }: { withTextarea?: boolean; disabledOk?: boolean }): React.JSX.Element {
    const [isOpen, setIsOpen] = useState(true)
    return (
      <Modal isOpen={isOpen} onClose={() => { setIsOpen(false) }} title="Confirm" enterActionTestId="ok">
        {withTextarea && <textarea data-testid="notes" />}
        <button data-testid="cancel" onClick={() => { setIsOpen(false) }}>Cancel</button>
        <button data-testid="ok" disabled={disabledOk} onClick={() => { document.body.dataset['okFired'] = 'true' }}>OK</button>
      </Modal>
    )
  }

  afterEach(() => { delete document.body.dataset['okFired'] })

  it('a plain Enter anywhere in the dialog clicks the designated button — even with Cancel focused', async () => {
    const { getByTestId } = render(<EnterHarness />)
    await waitFor(() => getByTestId('modal'))
    getByTestId('cancel').focus()
    fireEvent.keyDown(getByTestId('cancel'), { key: 'Enter' })
    expect(document.body.dataset['okFired']).toBe('true')
  })

  it('Enter inside a textarea keeps its native behaviour (no default action)', async () => {
    const { getByTestId } = render(<EnterHarness withTextarea />)
    await waitFor(() => getByTestId('modal'))
    getByTestId('notes').focus()
    fireEvent.keyDown(getByTestId('notes'), { key: 'Enter' })
    expect(document.body.dataset['okFired']).toBeUndefined()
  })

  it('modified Enter is never intercepted', async () => {
    const { getByTestId } = render(<EnterHarness />)
    await waitFor(() => getByTestId('modal'))
    getByTestId('cancel').focus()
    fireEvent.keyDown(getByTestId('cancel'), { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(getByTestId('cancel'), { key: 'Enter', ctrlKey: true })
    expect(document.body.dataset['okFired']).toBeUndefined()
  })

  it('a disabled designated button is not clicked', async () => {
    const { getByTestId } = render(<EnterHarness disabledOk />)
    await waitFor(() => getByTestId('modal'))
    getByTestId('cancel').focus()
    fireEvent.keyDown(getByTestId('cancel'), { key: 'Enter' })
    expect(document.body.dataset['okFired']).toBeUndefined()
  })
})

describe('Modal — initialFocusTestId', () => {
  function FocusHarness({ withTarget = true }: { withTarget?: boolean }): React.JSX.Element {
    const [isOpen, setIsOpen] = useState(true)
    return (
      <Modal isOpen={isOpen} onClose={() => { setIsOpen(false) }} title="Import" initialFocusTestId="url-field">
        <button data-testid="first-button">Cancel</button>
        {withTarget && <input data-testid="url-field" />}
      </Modal>
    )
  }

  it('focuses the designated element on open instead of the first focusable', async () => {
    const { getByTestId } = render(<FocusHarness />)
    await waitFor(() => getByTestId('modal'))
    await waitFor(() => {
      expect(document.activeElement).toBe(getByTestId('url-field'))
    })
  })

  it('falls back to the first focusable when nothing matches', async () => {
    const { getByTestId } = render(<FocusHarness withTarget={false} />)
    await waitFor(() => getByTestId('modal'))
    await waitFor(() => {
      expect(document.activeElement).toBe(getByTestId('modal-close'))
    })
  })
})
