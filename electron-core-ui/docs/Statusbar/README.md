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

## Notes for AI Usage

- Keep `title` compact and user-facing; move any long explanations or lists into `children` so they appear in the tooltip instead of the bar itself.
- Use `warning` and `error` flags only for **semantic** warnings/errors, not generic clicks, to avoid confusing color semantics.
- When wiring click handlers, call logging APIs (`logger.info`, etc.) rather than `console.log`, so logs remain centralized and consistent with the core UI’s logging rules.
