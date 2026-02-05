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
  'data-testid'?: string
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  onMouseDown?: (e: React.MouseEvent) => void
  className?: string
  /**
   * Vertical placement strategy:
   * - 'auto' (default): prefer above the target, but fall back below if there is not enough space.
   * - 'above': always position above the target (clamped to viewport).
   * - 'below': prefer below the target, falling back above only when there is no space below.
   */
  placement?: 'auto' | 'above' | 'below'
  side?: 'auto' | 'right' | 'left'
  fixedTop?: number
  repositionKey?: string | number | null
}
```

### Props

- **targetRef** (`RefObject<HTMLElement>`, required): Element the tooltip should anchor to.
- **content** (`ReactNode`, required): Tooltip body, can be text or JSX.
- **show** (`boolean`, required): Controls visibility; `true` renders and positions the tooltip.
- **data-testid** (`string`, optional): Optional test id applied to the tooltip root element.
- **onMouseEnter** (`() => void`, optional): Called when the user hovers the tooltip itself.
- **onMouseLeave** (`() => void`, optional): Called when the user leaves the tooltip.
- **onMouseDown** (`(e) => void`, optional): Called when mouse is pressed on the tooltip root.
- **className** (`string`, optional): Additional CSS classes merged with the base `.tooltip` class.
- **placement** (`'auto' | 'above' | 'below'`, optional): Controls vertical placement relative to the target; defaults to `'auto'`.
- **side** (`'auto' | 'left' | 'right'`, optional): Positions the tooltip left/right of the target.
- **fixedTop** (`number`, optional): Fixed top position (px). When set, overrides vertical placement calculation.
- **repositionKey** (`string | number | null`, optional): Forces repositioning when it changes.

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
- Supports side positioning:
  - `'right'`: tooltip to the right, beak on the left.
  - `'left'`: tooltip to the left, beak on the right.
- Repositions automatically when:
  - `show` changes.
  - `repositionKey` changes.
  - The window is scrolled (capturing scroll events).
  - The window is resized.
- Uses a CSS variable `--beak-left-percent` so the beak/arrow can visually point to the horizontal center of the target.
- Hides completely when `show === false` or `content` is falsy.

## Notes for AI Usage

- Manage `show` state in the **parent** component; `Tooltip` itself is intentionally stateless regarding visibility.
- Always reuse a single `Tooltip` per target rather than creating a new component instance on every render, to avoid layout thrashing.
- When integrating into more complex layouts (status bar, lists), ensure `targetRef` always points to a stable DOM element (not conditionally rendered), otherwise positioning may fail or flicker.

## Testing

### Stable `data-testid` and attributes

If you pass `data-testid`, the tooltip exposes stable attributes:

- `data-is-positioned="true|false"`
- `data-top="..."` and `data-left="..."` (rounded)
- `data-placement="above|below"`
- `data-side="auto|left|right"`

### Selectors (`electron-core-ui/testing`)

- `tooltipRootSelector(testId)`
- `tooltipContentSelector(testId)`

### Playwright-BDD steps (`electron-core-ui/testing/playwright-bdd`)

Reusable steps are available via `defineTooltipBddSteps`:

- `Then tooltip {string} should be visible`
- `Then tooltip {string} should be hidden`
- `Then tooltip {string} data-placement should be {string}`
- `Then tooltip {string} data-side should be {string}`
- `Then tooltip {string} should be right of {string}`
- `Then tooltip {string} should be left of {string}`
- `Then tooltip {string} should be above {string}`
- `Then tooltip {string} should be below {string}`
- `Then tooltip {string} beak left percent should be {int}`
- `Then tooltip {string} beak should point to {string} vertically`
- `Then tooltip {string} beak should point to {string} horizontally`
- `Then tooltip {string} data-top should be {int}`
