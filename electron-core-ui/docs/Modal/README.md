# Modal Component

## Overview

The `Modal` component renders a full–window modal dialog with an overlay, using theme
variables and the same base styles as the workbench.

- The modal covers the entire viewport with a semi‑transparent backdrop.
- The inner dialog has a **20px margin** on all sides, a title bar, and a close button in the top‑right.
- Pressing the **Escape** key or clicking the close button closes the modal.

Base fonts, codicons and focus styles are inherited from `Workbench`, which wraps the modal
contents and pulls in `workbench.css` for you.

## Component Location

- Source: `electron-core-ui/src/renderer/components/Modal/Modal.tsx`
- Styles:
  - `electron-core-ui/src/renderer/assets/workbench.css` (global workbench styles, applied via `Workbench`)
  - `electron-core-ui/src/renderer/components/Modal/modal.css` (modal‑specific styles)

## API

```ts
export interface ModalProps {
  /** Title displayed in the modal header (string or JSX). */
  title: React.ReactNode
  /** When false, the modal is not rendered at all. */
  isOpen: boolean
  /** Called when the user requests to close the modal (Esc key or close button). */
  onClose: () => void
  /**
   * Called once the close animation has finished and the modal has
   * fully unmounted its content — the "really closed" signal, as
   * opposed to `onClose` (fired the instant a close is requested).
   * Use it when something outside the modal must only react after the
   * fade completes. Driven by the overlay's `transitionend`, so it is
   * robust against React StrictMode's mount/unmount probing.
   */
  onClosed?: () => void
  /** Modal body content. Usually a layout or form. */
  children: React.ReactNode
  /** Modal size: 'full' for fullscreen-like, 'dialog' for compact dialog box */
  size?: 'full' | 'dialog'
  /** Dialog-size only: widens the compact dialog beyond its default 320-480px
   * envelope (any CSS width — applied as width + max-width, capped at 92vw).
   * Ignored for size='full'. */
  dialogWidth?: number | string
  /** Optional test id applied to the modal container. Defaults to `modal`. */
  'data-testid'?: string
  /**
   * Scope the modal to a CONTAINER instead of the whole window. When set, the
   * modal portals into the nearest ancestor matching this CSS selector and its
   * overlay is positioned `absolute; inset: 0` over that container rather than
   * `fixed` over the viewport. Falls back to full-window when no ancestor
   * matches. See "Scoping to a container" below.
   */
  scopeToSelector?: string
  /**
   * `data-testid` of the button (inside the dialog) that a plain Enter
   * keypress triggers — the dialog's default action. See "Keyboard
   * handling" below.
   */
  enterActionTestId?: string
  /**
   * `data-testid` of the element focused on open, instead of the default
   * first-focusable-in-DOM-order (the header close button). Lets a dialog
   * whose entry point is a form field open ready to type. Falls back to the
   * default when nothing matches. Only meaningful with `trapFocus`.
   */
  initialFocusTestId?: string
  /**
   * Move focus into the dialog on open, trap Tab inside it, and restore
   * focus to the previously-focused element on close. Defaults to `true`.
   * Set to `false` for a maximize-style wrapper around pre-existing content
   * (see "Focus management" below).
   */
  trapFocus?: boolean
}
```

- The modal is **controlled**: you are responsible for updating `isOpen` in response to `onClose`.
- Keyboard handling:
  - When `isOpen` is `true`, a `keydown` listener is attached to `window`.
  - Pressing `Escape` invokes `onClose()`.
  - With `enterActionTestId` set, a plain `Enter` pressed inside the dialog clicks the designated button — the dialog's **default action**, à la OS dialogs. Without it, Enter merely activates whatever holds focus (on open that is the first focusable, typically a Cancel button — so Enter dismissed a fresh confirm dialog without doing the action). Guards: focus in a multiline surface (`<textarea>`, contenteditable, Monaco) keeps its native Enter; modified Enter (Shift/Ctrl/Alt/Meta) is never intercepted; a disabled designated button is not clicked.

```tsx
<Modal title="Delete item" isOpen={open} onClose={cancel} size="dialog" enterActionTestId="confirm-delete-ok">
  <p>Really delete?</p>
  <Button data-testid="confirm-delete-cancel" secondary onClick={cancel}>Cancel</Button>
  <Button data-testid="confirm-delete-ok" onClick={doDelete}>Delete</Button>
</Modal>
```
- `onClose` vs `onClosed`: `onClose` fires when the user *requests* a close (start of the fade-out); `onClosed` fires after the fade-out animation completes and the content has unmounted. Most consumers only need `onClose`.

## Focus management

By default (`trapFocus={true}`), the dialog follows the standard `role="dialog" aria-modal="true"` contract for keyboard + screen-reader users:

- **On open**, focus moves to the first focusable element inside the dialog (the close button, in DOM order), or the dialog container itself if it has no focusable children.
- **While open**, `Tab` / `Shift+Tab` are trapped inside the dialog, wrapping last→first and first→last.
- **On close**, focus is restored to whatever element had it before the dialog opened.

Set `trapFocus={false}` when `Modal` is reused as a bare "show this existing content bigger" wrapper rather than an actual dialog — e.g. a workbench tab's maximize view (`EditorWorkbench`) or `Tabs`'s own `allowFullscreen` double-click. In that case the content isn't a separate interaction the user "entered"; it's the same instance, relocated to fill the screen, and the user's existing focus (mid-edit in an embedded editor, a console, …) must survive the maximize/restore toggle untouched instead of jumping to the close button. `Escape`-to-close still works with `trapFocus={false}` — it's handled by a separate, unconditional keydown listener.

## Basic Usage

```tsx
import React, { useState } from 'react'
import { Modal, Button } from 'electron-core-ui/renderer'

const Example: React.FC = () => {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        secondary
        onClick={() => { setOpen(true) }}
      >
        Open modal
      </Button>

      <Modal
        isOpen={open}
        onClose={() => { setOpen(false) }}
        title="Example modal"
      >
        <div style={{ flex: 1, minHeight: 0 }}>
          {/* Your content here - e.g. a SplitView, ListView or editor */}
          <p>This is the modal content.</p>
        </div>
      </Modal>
    </>
  )
}
```

## Scoping to a container

By default the modal portals to `document.body` and its overlay is `position: fixed` over the whole viewport. Pass `scopeToSelector` to instead contain it to a region — e.g. a single workbench tab — so the backdrop (and, with advanced visual effects on, its `backdrop-filter` blur) only covers that region:

```tsx
<Modal
  title="Run history"
  isOpen={isOpen}
  onClose={onClose}
  scopeToSelector=".my-workbench-tab"
>
  {/* … */}
</Modal>
```

- An invisible in-place anchor resolves the nearest ancestor matching the selector (`anchor.closest(selector)`); the overlay portals **there** and gets `data-scoped="true"` → `position: absolute; inset: 0`. The matched ancestor must be a **positioned** element (`position: relative` or similar).
- The anchor stays mounted across open/close so it can re-resolve on the next open — render the `<Modal>` unconditionally (drive visibility via `isOpen`), don't gate it behind `{isOpen && …}`.
- The window-drag strip is suppressed and the container's top inset is tightened (no app title-bar to clear) in scoped mode.
- If **no** matching ancestor is found, it falls back to the normal full-window behaviour.

## Theming and Layout

- The overlay (`.ecu-modal-overlay`) uses:
  - `background-color: rgba(0, 0, 0, 0.4)`
- The container (`.ecu-modal-container`) is positioned with `top/left/right/bottom: 20px`,
  which ensures a **20px margin** around the dialog on all edges.
- The header uses:
  - `var(--titleBar-activeBackground)` for background.
  - `var(--titleBar-activeForeground)` for text and close icon.
- Fonts, codicon sizes and focus outlines come from `Workbench` / `workbench.css`, so the modal feels
  visually integrated with the rest of the UI.

### Title-bar drag passthrough while a modal is open

The first child of `.ecu-modal-overlay` is `.ecu-modal-drag-strip`: a transparent absolutely-positioned div sized to `var(--titlebar-height, 32px)` and carrying `-webkit-app-region: drag`. It lets the user **move the window from the title-bar area even with a modal open** — without it the overlay would swallow OS-level drag events on the title-bar region. The strip exposes a stable test id derived from the modal's overlay testid: `${overlayTestId}-drag-strip`.

The strip's `right` is set to `var(--wco-width, 0)` so it leaves a gap for the host app's window-controls overlay (see [`CustomWCO`](../CustomWCO/README.md) for the source of `--wco-width`). Combined with `CustomWCO`'s body-level portal + elevated `z-index`, this keeps minimize / maximize / close clickable while a modal is open.

## Testing

### `data-testid` API

`Modal` exposes stable E2E hooks via `data-testid` (default: `modal`).
When `data-testid="my-modal"` is provided:

- Overlay: `my-modal-overlay`
  - attributes:
    - `data-state`: `open|closing|closed`
- Container: `my-modal`
  - attributes:
    - `data-size`: `full|dialog`
    - `data-is-open`: `true|false`
- Header: `my-modal-header`
- Title: `my-modal-title`
- Body: `my-modal-body`
- Close button (`Button`): `my-modal-close`

### Selectors (electron-core-ui/testing)

- `modalRootSelector(testId)`
- `modalOverlaySelector(testId)`
- `modalHeaderSelector(testId)`
- `modalTitleSelector(testId)`
- `modalBodySelector(testId)`
- `modalCloseButtonTestId(testId)`
- `modalCloseButtonSelector(testId)`

### Playwright-BDD steps (electron-core-ui/testing/playwright-bdd)

Register:

- `defineModalBddSteps(bdd)`
- `defineButtonBddSteps(bdd)` (useful to interact with harness buttons)

Steps:

- `Then modal {string} should be visible`
- `Then modal {string} should be hidden`
- `Then modal {string} state should be {string}`
- `Then modal {string} size should be {string}`
- `When I close modal {string} with Escape`
- `When I close modal {string} with close button`
- `When I close modal {string} with header middle click`
