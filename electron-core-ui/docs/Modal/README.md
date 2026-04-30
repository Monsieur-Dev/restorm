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
  /** Modal body content. Usually a layout or form. */
  children: React.ReactNode
  /** Modal size: 'full' for fullscreen-like, 'dialog' for compact dialog box */
  size?: 'full' | 'dialog'
  /** Optional test id applied to the modal container. Defaults to `modal`. */
  'data-testid'?: string
}
```

- The modal is **controlled**: you are responsible for updating `isOpen` in response to `onClose`.
- Keyboard handling:
  - When `isOpen` is `true`, a `keydown` listener is attached to `window`.
  - Pressing `Escape` invokes `onClose()`.

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
