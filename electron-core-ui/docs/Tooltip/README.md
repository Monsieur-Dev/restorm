# Tooltip Component

## Overview

`Tooltip` is a low-level overlay used by the status bar and other components to display rich tooltip content.  
It positions itself relative to a `targetRef`, taking scroll and window resize into account, and exposes simple hooks for hover behavior.

## API

### Types

```typescript
export interface TooltipProps {
  targetRef: React.RefObject<HTMLElement>
  content: React.ReactNode
  show: boolean
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  className?: string
  /**
   * Vertical placement strategy:
   * - 'auto' (default): prefer above the target, but fall back below if there is not enough space.
   * - 'above': always position above the target (clamped to viewport).
   * - 'below': prefer below the target, falling back above only when there is no space below.
   */
  placement?: 'auto' | 'above' | 'below'
}
```

### Props

- **targetRef** (`RefObject<HTMLElement>`, required): Element the tooltip should anchor to.
- **content** (`ReactNode`, required): Tooltip body, can be text or JSX.
- **show** (`boolean`, required): Controls visibility; `true` renders and positions the tooltip.
- **onMouseEnter** (`() => void`, optional): Called when the user hovers the tooltip itself.
- **onMouseLeave** (`() => void`, optional): Called when the user leaves the tooltip.
- **className** (`string`, optional): Additional CSS classes merged with the base `.tooltip` class.
- **placement** (`'auto' | 'above' | 'below'`, optional): Controls vertical placement relative to the target; defaults to `'auto'`.

## Usage

```tsx
import React, { useRef, useState } from 'react'
import { Tooltip } from 'electron-core-ui/renderer'

const Example: React.FC = () => {
  const targetRef = useRef<HTMLDivElement | null>(null)
  const [show, setShow] = useState(false)

  return (
    <>
      <div
        ref={targetRef}
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        style={{ padding: 8 }}
      >
        Hover me
      </div>

      <Tooltip
        targetRef={targetRef}
        show={show}
        content={<div>Tooltip content with <strong>rich text</strong>.</div>}
      />
    </>
  )
}
```

## Behavior

- Computes the position from `targetRef.getBoundingClientRect()` and keeps the tooltip centered over the target by default.
- Supports vertical placement:
  - `'auto'`: prefers above the target (status bar–style) and falls back below if there is not enough space.
  - `'above'`: forces the tooltip above the target (clamped inside the viewport).
  - `'below'`: prefers below the target and falls back above only when there is no room below.
- Repositions automatically when:
  - `show` changes.
  - The window is scrolled (capturing scroll events).
  - The window is resized.
- Uses a CSS variable `--beak-left-percent` so the beak/arrow can visually point to the horizontal center of the target.
- Hides completely when `show === false` or `content` is falsy.

## Notes for AI Usage

- Manage `show` state in the **parent** component; `Tooltip` itself is intentionally stateless regarding visibility.
- Always reuse a single `Tooltip` per target rather than creating a new component instance on every render, to avoid layout thrashing.
- When integrating into more complex layouts (status bar, lists), ensure `targetRef` always points to a stable DOM element (not conditionally rendered), otherwise positioning may fail or flicker.
