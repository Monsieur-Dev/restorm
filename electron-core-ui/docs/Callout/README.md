# Callout

Status message component for React applications.

## Overview

The `Callout` component displays a short message with a severity level (variant) and an icon.

## Installation

```typescript
import { Callout } from 'electron-core-ui/renderer'
```

## Component

### Callout

#### Props

```typescript
export type CalloutVariant = 'info' | 'warning' | 'error' | 'debug'

export interface CalloutProps {
  /** The variant/style of the callout */
  variant: CalloutVariant
  /** The message to display */
  message: string
  /** Optional test id for stable E2E selectors */
  'data-testid'?: string
  /** Optional custom icon (codicon name without 'codicon-' prefix). Defaults based on variant. */
  icon?: string
  /** Optional className for additional styling */
  className?: string
  /** Optional inline actions rendered after the message — typically one or two `<Button>`s. Use for non-modal "confirm / dismiss" callouts. */
  actions?: React.ReactNode
}
```

#### Usage

```tsx
import React from 'react'
import { Callout } from 'electron-core-ui/renderer'

export const Example: React.FC = () => {
  return (
    <Callout
      variant="warning"
      message="This action cannot be undone."
      data-testid="danger-warning"
    />
  )
}
```

#### With inline actions

```tsx
import React from 'react'
import { Callout, Button } from 'electron-core-ui/renderer'

export const InlineConfirm: React.FC<{ onApply: () => void; onCancel: () => void }> = ({ onApply, onCancel }) => {
  return (
    <Callout
      variant="info"
      message="Detected a curl command on the clipboard."
      data-testid="curl-paste-callout"
      actions={
        <>
          <Button small onClick={onApply}>Replace request</Button>
          <Button small secondary onClick={onCancel}>Cancel</Button>
        </>
      }
    />
  )
}
```

The `actions` slot sits flush against the message inside the same flex row — no extra wrapper needed by the caller.

## Testing

### Recommended stable hooks

If you pass a `data-testid` to the component, you can target:

- Root: `[data-testid="..."]`
- Message: `.ecu-callout-message`
- Icon: `.codicon`

The root element also exposes stable attributes:

- `data-variant` (one of `info|warning|error|debug`)
- `data-icon` (effective icon name, either default or `icon` override)

### E2E helpers

`electron-core-ui/testing` exports selector helpers:

- `calloutTestIdSelector(testId)`
- `calloutMessageSelector(testId)`
- `calloutIconSelector(testId)`

### Playwright-BDD steps

If you use Playwright-BDD, `electron-core-ui/testing/playwright-bdd` exports `defineCalloutBddSteps(bdd)`.
It registers generic steps such as:

- `Then callout {string} should have variant {string}`
- `Then callout {string} message should be {string}`
- `Then callout {string} icon should be {string}`

