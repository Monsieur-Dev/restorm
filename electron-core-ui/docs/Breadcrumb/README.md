# Breadcrumb

VSCode-style breadcrumb navigation component for React applications.

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
  /** Called when an item is clicked (including the last item when shown as a label). */
  onItemClick?: (item: BreadcrumbItem, index: number, event: React.MouseEvent<HTMLButtonElement>) => void
  /**
   * Called when the editable last item loses focus or is submitted (Enter key).
   * Receives the new value and the index of the last item.
   */
  onLastItemChange?: (value: string, index: number) => void
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

  const handleLastItemChange = (value: string, index: number): void => {
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
      onItemClick={handleItemClick}
      onLastItemChange={handleLastItemChange}
    />
  )
}
```

## Styling

### CSS Variables

The component uses standard VSCode CSS variables for theming:

- `--vscode-breadcrumb-background`
- `--vscode-breadcrumb-foreground`
- `--vscode-breadcrumb-focusForeground`
- `--vscode-input-background`
- `--vscode-input-foreground`
- `--vscode-input-border`
- `--vscode-focusBorder`

### Classes

- `.ecui-breadcrumb`: root container
- `.ecui-breadcrumb-list`: `<ol>` wrapper for breadcrumb items
- `.ecui-breadcrumb-item`: single breadcrumb item
- `.ecui-breadcrumb-item--last`: applied to the last item
- `.ecui-breadcrumb-link`: button used for clickable labels
- `.ecui-breadcrumb-link--current`: applied to the last item in label mode (rendered in bold)
- `.ecui-breadcrumb-input`: input used when editing the last item
- `.ecui-breadcrumb-separator`: wrapper for the chevron separator icon

## Notes for AI Usage

- Treat `items` as a **pure, ordered path** in your domain model (e.g. workspace → folder → resource) and rebuild it from state rather than mutating labels in-place, except when handling `onLastItemChange`.
- Use stable `id` values that map directly to domain entities; this makes it easier for AI agents to translate breadcrumb clicks into navigation actions.
- Keep rename logic confined to a small handler (e.g. `onLastItemChange`) so that agents can safely update the last segment’s label without touching the rest of the path.
