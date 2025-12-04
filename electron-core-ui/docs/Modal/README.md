# Modal Component

## Overview

The `Modal` component renders a full–window modal dialog with a blurred overlay, using VS Code theme
variables and the same base styles as the workbench.

- The modal covers the entire viewport with a semi‑transparent, blurred backdrop.
- The inner dialog has a **20px margin** on all sides, a title bar, and a close button in the top‑right.
- Pressing the **Escape** key or clicking the close button closes the modal.

Base fonts, codicons and focus styles are inherited from `MonacoWorkbench`, which wraps the modal
contents and pulls in `monaco-workbench.css` for you.

## Component Location

- Source: `electron-core-ui/src/renderer/components/Modal/Modal.tsx`
- Styles:
  - `electron-core-ui/src/renderer/assets/monaco-workbench.css` (global workbench styles, applied via `MonacoWorkbench`)
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
  - `backdrop-filter: blur(4px)` to softly blur the underlying workbench.
- The container (`.ecu-modal-container`) is positioned with `top/left/right/bottom: 20px`,
  which ensures a **20px margin** around the dialog on all edges.
- The header uses:
  - `var(--vscode-titleBar-activeBackground)` for background.
  - `var(--vscode-titleBar-activeForeground)` for text and close icon.
- Fonts, codicon sizes and focus outlines come from `MonacoWorkbench` / `monaco-workbench.css`, so the modal feels
  visually integrated with the rest of the VS Code‑like UI.


