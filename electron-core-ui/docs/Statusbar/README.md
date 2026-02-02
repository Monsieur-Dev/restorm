# Statusbar Component

## Overview

`Statusbar` and `StatusbarElement` render a styled status bar at the bottom of the window.  
They are used to display small pieces of state (ready, warnings, errors, notifications) with optional tooltips and click handlers.

## API

### Types

```typescript
export interface StatusbarProps {
  children?: React.ReactNode
  className?: string
  id?: string
}

export interface StatusbarElementProps {
  title: string | React.ReactNode
  warning?: boolean
  error?: boolean
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void
  className?: string
  id?: string
  children?: React.ReactNode
}
```

## Usage

```tsx
import React from 'react'
import { Statusbar, StatusbarElement, logger } from 'electron-core-ui/renderer'

const AppStatusbar: React.FC = () => {
  return (
    <Statusbar>
      <StatusbarElement title="Ready" />

      <StatusbarElement
        title={
          <>
            <i className="codicon codicon-warning" /> Warnings
          </>
        }
        warning
      >
        Some warning tooltip content
      </StatusbarElement>

      <StatusbarElement
        title={
          <>
            <i className="codicon codicon-error" /> Errors
          </>
        }
        error
        onClick={() => {
          logger.info('Statusbar errors clicked')
        }}
      >
        Error details tooltip content
      </StatusbarElement>
    </Statusbar>
  )
}
```

## Behavior

- `Statusbar` lays out its children horizontally.
- `StatusbarElement`:
  - Uses `title` as the visible label in the bar.
  - Uses `children` as the tooltip content shown by the `Tooltip` component in the demo.
  - Applies theme colors for normal / warning / error states.
  - Accepts `onClick` for interactive elements (e.g. open problems view, toggle panel).

## Testing

### `data-testid` API

`Statusbar` and `StatusbarElement` expose stable test hooks via `data-testid` props:

- `Statusbar`: `data-testid` (default: `statusbar`)
  - root attributes: `data-item-count`
- `StatusbarElement`: `data-testid`
  - root attributes: `data-warning`, `data-error`, `data-clickable`, `data-has-tooltip`, `data-tooltip-visible`
  - derived ids:
    - label: `${elementId}-label`
    - tooltip (Tooltip root): `${elementId}-tooltip`

### Selectors (electron-core-ui/testing)

Available helpers:

- `statusbarRootSelector(testId)`
- `statusbarElementSelector(elementId)`
- `statusbarElementLabelSelector(elementId)`
- `statusbarElementTooltipSelector(elementId)`

### Playwright-BDD steps (electron-core-ui/testing/playwright-bdd)

Register steps:

- `defineStatusbarBddSteps(bdd)`

Core steps:

- `Then statusbar {string} should be visible`
- `Then statusbar {string} should have {int} elements`
- `Then statusbar element {string} should have warning {string}`
- `Then statusbar element {string} should have error {string}`
- `Then statusbar element {string} should be clickable {string}`
- `When I hover statusbar element {string}`
- `Then statusbar element {string} tooltip should be visible`
- `When I move mouse away from statusbar element {string}`
- `Then statusbar element {string} tooltip should be hidden`
- `When I click statusbar element {string}`
- `When I press {string} on statusbar element {string}` (e.g. `Enter`, `Space`)

### Tooltip integration

Since `StatusbarElement` uses `Tooltip`, the tooltip root is also addressable as `${elementId}-tooltip`, and you can additionally reuse tooltip-specific assertions by registering `defineTooltipBddSteps(bdd)` when needed.

## Notes for AI Usage

- Keep `title` compact and user-facing; move any long explanations or lists into `children` so they appear in the tooltip instead of the bar itself.
- Use `warning` and `error` flags only for **semantic** warnings/errors, not generic clicks, to avoid confusing color semantics.
- When wiring click handlers, call logging APIs (`logger.info`, etc.) rather than `console.log`, so logs remain centralized and consistent with the core UI’s logging rules.
