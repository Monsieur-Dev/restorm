# Breadcrumb

Breadcrumb navigation component for React applications.

## Overview

The `Breadcrumb` component displays the current navigation path as a horizontal list of clickable segments.
All items behave like links, and the **last item is editable**: when clicked, it turns into a text input, and
on blur it reverts back to a label.

## Installation

```typescript
import { Breadcrumb } from 'electron-core-ui/renderer'
```

## Component

### Breadcrumb

#### Props

```typescript
export interface BreadcrumbItem {
  id: string
  label: string
}

export interface BreadcrumbProps {
  /** Ordered list of breadcrumb items to display. */
  items: BreadcrumbItem[]
  /** Optional test id applied to the root element. */
  'data-testid'?: string
  /** Called when an item is clicked (including the last item when shown as a label). */
  onItemClick?: (item: BreadcrumbItem, index: number, event: React.MouseEvent<HTMLButtonElement>) => void
  /**
   * Called when the editable last item loses focus or is submitted (Enter key).
   * Receives the item, the new value, and the index.
   */
  onLastItemChange?: (item: BreadcrumbItem, newValue: string, index: number) => void
  className?: string
  style?: React.CSSProperties
  ariaLabel?: string
}
```

#### Basic Usage

```tsx
import React, { useState } from 'react'
import { Breadcrumb, type BreadcrumbItem } from 'electron-core-ui/renderer'

const Example: React.FC = () => {
  const [items, setItems] = useState<BreadcrumbItem[]>([
    { id: 'root', label: 'workspace' },
    { id: 'folder', label: 'collections' },
    { id: 'leaf', label: 'current-request' }
  ])

  const handleItemClick = (item: BreadcrumbItem, index: number): void => {
    console.log('Breadcrumb clicked', { item, index })
    // Perform navigation here
  }

  const handleLastItemChange = (_item: BreadcrumbItem, value: string, index: number): void => {
    setItems((prev) => {
      if (index < 0 || index >= prev.length) return prev
      const next = [...prev]
      next[index] = { ...next[index], label: value }
      return next
    })
  }

  return (
    <Breadcrumb
      items={items}
      data-testid="breadcrumb-main"
      onItemClick={handleItemClick}
      onLastItemChange={handleLastItemChange}
    />
  )
}
```

## Testing

### Recommended stable selectors

If you pass a `data-testid` to the component, you can target the whole breadcrumb with:

- Root: `[data-testid="..."]`

The component also exposes stable internal hooks for tests:

- Last item label (view mode): `li.ecui-breadcrumb-item--last .ecui-editable-label:not(.ecui-editable-label--editing)` (rendered by the shared [`EditableLabel`](../EditableLabel/README.md))
- Edit input (edit mode): `input.ecui-editable-label-input`
- Non-last items (navigation): `li.ecui-breadcrumb-item:not(.ecui-breadcrumb-item--last) button.ecui-breadcrumb-link`

### E2E helpers

The testing module exports pure selectors you can reuse in Playwright tests:

- `breadcrumbRootSelector(testId)`
- `breadcrumbNonLastItemsSelector(testId)`
- `breadcrumbLastLabelSelector(testId)`
- `breadcrumbEditInputSelector(testId)`

They are available from `electron-core-ui/testing`.

### Playwright-BDD steps

If you use Playwright-BDD, you can register a reusable step pack from `electron-core-ui/testing/playwright-bdd`:

- `defineBreadcrumbBddSteps(bdd)`

This provides generic steps such as:

- `When I click breadcrumb {string} item index {int}`
- `When I start editing breadcrumb {string} last item`
- `When I set breadcrumb {string} last item to {string}`
- `Then the last breadcrumb label in {string} should be {string}`

## Styling

### CSS Variables

The component uses standard theme CSS variables for theming:

- `--breadcrumb-background`
- `--breadcrumb-foreground`
- `--breadcrumb-focusForeground`
- `--input-background`
- `--input-foreground`
- `--input-border`
- `--focusBorder`

### Classes

- `.ecui-breadcrumb`: root container
- `.ecui-breadcrumb-list`: `<ol>` wrapper for breadcrumb items
- `.ecui-breadcrumb-item`: single breadcrumb item
- `.ecui-breadcrumb-item--last`: applied to the last item
- `.ecui-breadcrumb-link`: button used for clickable labels
- `.ecui-breadcrumb-link--current`: applied to the last item in label mode (rendered in bold)
- Last-item edit input: rendered by [`EditableLabel`](../EditableLabel/README.md) as `input.ecui-editable-label-input`
- `.ecui-breadcrumb-separator`: wrapper for the chevron separator icon

## Notes for AI Usage

- Treat `items` as a **pure, ordered path** in your domain model (e.g. workspace → folder → resource) and rebuild it from state rather than mutating labels in-place, except when handling `onLastItemChange`.
- Use stable `id` values that map directly to domain entities; this makes it easier for AI agents to translate breadcrumb clicks into navigation actions.
- Keep rename logic confined to a small handler (e.g. `onLastItemChange`) so that agents can safely update the last segment’s label without touching the rest of the path.
