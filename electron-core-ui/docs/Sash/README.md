# Sash Component

## Overview

`Sash` is a low-level splitter handle used to resize panels (e.g. a tree + editor layout).  
It delegates positioning to a layout provider and fires drag events so the host can update panel sizes.

## API

### Types

```typescript
export type SashOrientation = 'vertical' | 'horizontal'
export type SashState = 'enabled' | 'disabled' | 'atMinimum' | 'atMaximum'

export interface SashEvent {
  readonly startX: number
  readonly currentX: number
  readonly startY: number
  readonly currentY: number
  readonly altKey: boolean
}

export interface Sash {
  readonly orientation: SashOrientation
}

export interface IVerticalSashLayoutProvider {
  getVerticalSashLeft(sash: Sash): number
  getVerticalSashTop?(sash: Sash): number
  getVerticalSashHeight?(sash: Sash): number
}

export interface IHorizontalSashLayoutProvider {
  getHorizontalSashTop(sash: Sash): number
  getHorizontalSashLeft?(sash: Sash): number
  getHorizontalSashWidth?(sash: Sash): number
}

export type SashLayoutProvider = IVerticalSashLayoutProvider | IHorizontalSashLayoutProvider

export interface SashProps {
  orientation: SashOrientation
  layoutProvider: SashLayoutProvider
  state?: SashState
  size?: number
  hoverDelay?: number
  onStart?: (event: SashEvent) => void
  onChange?: (event: SashEvent) => void
  onEnd?: () => void
  onReset?: () => void
  className?: string
  'data-testid'?: string
}
```

## Usage (vertical split)

```tsx
import React, { useMemo, useRef, useState, useEffect } from 'react'
import { Sash, type IVerticalSashLayoutProvider, type SashEvent } from 'electron-core-ui/renderer'

const SplitPane: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [leftWidth, setLeftWidth] = useState(260)
  const [containerHeight, setContainerHeight] = useState(0)
  const startLeftRef = useRef(leftWidth)

  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver(() => {
      if (containerRef.current) {
        setContainerHeight(containerRef.current.clientHeight)
      }
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  const layoutProvider: IVerticalSashLayoutProvider = useMemo(
    () => ({
      getVerticalSashLeft: () => leftWidth,
      getVerticalSashTop: () => 0,
      getVerticalSashHeight: () => containerHeight
    }),
    [leftWidth, containerHeight]
  )

  const handleStart = (event: SashEvent): void => {
    startLeftRef.current = leftWidth
  }

  const handleChange = (event: SashEvent): void => {
    if (!containerRef.current) return
    const delta = event.currentX - event.startX
    const containerWidth = containerRef.current.clientWidth
    const min = 150
    const max = Math.max(min, containerWidth - 200)
    const next = Math.min(max, Math.max(min, startLeftRef.current + delta))
    setLeftWidth(next)
  }

  return (
    <div ref={containerRef} style={{ display: 'flex', position: 'relative', width: '100%', height: '100%' }}>
      <div style={{ width: leftWidth }}>Left pane</div>
      <div style={{ flex: 1 }}>Right pane</div>
      <Sash
        orientation="vertical"
        layoutProvider={layoutProvider}
        onStart={handleStart}
        onChange={handleChange}
        size={4}
      />
    </div>
  )
}
```

## Notes for AI Usage

- Always let the **layout provider** compute sash coordinates; do not hard-code positions inside the Sash component.
- Use a `ResizeObserver` (as in the example) to keep heights/widths up to date when the container resizes.
- Keep drag logic **pure** and bounded (clamp values with `min`/`max`) to avoid invalid layouts or negative sizes when the user drags aggressively or resizes the window quickly.

## Testing

When `data-testid` is provided, the components expose stable hooks for E2E tests.

### `Sash` data-testid conventions

- Root: `{id}`

### `Sash` stable data attributes (on root)

- `data-orientation`: `vertical | horizontal`
- `data-state`: `enabled | disabled | atMinimum | atMaximum`
- `data-is-hovered`: `true | false`
- `data-is-active`: `true | false`
- `data-left`, `data-top`, `data-width`, `data-height`: numbers (rounded)

### `VerticalSashContainer` data-testid conventions

- Root: `{id}`
- Left pane: `{id}-left`
- Right pane: `{id}-right`
- Sash: `{id}-sash`

### `VerticalSashContainer` stable data attributes (on root)

- `data-left-width`: number
- `data-container-width`: number
- `data-min-left-width`: number
- `data-min-right-width`: number
- `data-sash-state`: `enabled | atMinimum | atMaximum`
- `data-is-resizing`: `true | false`

### `HorizontalSashContainer` data-testid conventions

- Root: `{id}`
- Top pane: `{id}-top`
- Bottom pane: `{id}-bottom`
- Sash: `{id}-sash`

### `HorizontalSashContainer` stable data attributes (on root)

- `data-top-height`: number
- `data-container-height`: number
- `data-min-top-height`: number
- `data-min-bottom-height`: number
- `data-sash-state`: `enabled | atMinimum | atMaximum`
- `data-is-resizing`: `true | false`

### Selectors

- `sashRootSelector(testId)`
- `verticalSashContainerRootSelector(testId)`
- `verticalSashContainerLeftSelector(testId)`
- `verticalSashContainerRightSelector(testId)`
- `verticalSashContainerSashSelector(testId)`
- `horizontalSashContainerRootSelector(testId)`
- `horizontalSashContainerTopSelector(testId)`
- `horizontalSashContainerBottomSelector(testId)`
- `horizontalSashContainerSashSelector(testId)`

### Playwright-BDD steps

- `Then sash {string} should be visible`
- `Then sash {string} data-orientation should be {string}`
- `Then sash {string} data-state should be {string}`
- `When I drag sash {string} by x {int} y {int}`
- `When I double click sash {string}`
- `Then vertical sash container {string} should be visible`
- `Then vertical sash container {string} left width should be {int}` (tolerance ±1)
- `Then vertical sash container {string} sash state should be {string}`
- `When I drag vertical sash container {string} by {int}`
- `Then horizontal sash container {string} should be visible`
- `Then horizontal sash container {string} top height should be {int}` (tolerance ±1)
- `Then horizontal sash container {string} sash state should be {string}`
- `When I drag horizontal sash container {string} by {int}`
