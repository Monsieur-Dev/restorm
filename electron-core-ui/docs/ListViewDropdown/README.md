# ListViewDropdown Component

## Overview

`ListViewDropdown` is a small composition component that combines a `Button` with a `ListView` rendered inside a dropdown panel.
It is designed for scenarios where you need to select an item (or items) from a hierarchical list/tree using a compact trigger button (e.g. environment selector, workspace/project picker).

The component handles open/close state, outside clicks, and Escape key handling, while delegating actual list behavior to `ListView`.

## Component Location

- Source: `electron-core-ui/src/renderer/components/ListViewDropdown/ListViewDropdown.tsx`

## Props

```typescript
export interface ListViewDropdownProps {
  items: ListViewItemData[]
  selectedIds?: string[]
  expandedIds?: string[]
  selectionMode?: ListViewSelectionMode
  rootRole?: 'tree' | 'list'
  /** Accessible label for the list inside the dropdown */
  menuAriaLabel?: string
  /** Alignment of the dropdown relative to the button (default: right) */
  align?: 'left' | 'right'
  /** Minimum width of the dropdown panel (default: 220) */
  minWidth?: number
  /** Maximum height of the dropdown panel (default: 320) */
  maxHeight?: number
  /** Props forwarded to the underlying Button (except onClick and children) */
  buttonProps?: Omit<ButtonProps, 'onClick' | 'children'>
  /** Content rendered inside the trigger button */
  buttonContent: React.ReactNode
  /** Called when an item is clicked. The dropdown closes after this callback. */
  onItemClick?: (payload: ListViewItemEventPayload) => void
  /** Called when an item is expanded/collapsed. */
  onItemToggle?: (payload: ListViewItemEventPayload, expanded: boolean) => void
}
```

> `ListViewItemData`, `ListViewItemEventPayload`, `ListViewSelectionMode` and `ButtonProps` are already exported by `electron-core-ui/renderer`.

## Behavior Details

- **Open/close logic**:
  - The dropdown is controlled internally through a local `isOpen` state.
  - Clicking the button toggles `isOpen`.
  - Clicking outside the dropdown or pressing `Escape` closes it.
- **Selection**:
  - The selection is forwarded to `ListView` via `selectedIds` and `selectionMode`.
  - When an item is clicked, `onItemClick` is called and the dropdown closes automatically.
- **Expansion**:
  - Tree expansion can be controlled via `expandedIds`.
  - `onItemToggle` is passed through to `ListView` and is not intercepted.
- **Layout**:
  - The dropdown panel is absolutely positioned relative to the button container.
  - Use `align="left"` or `align="right"` to control horizontal alignment.
  - `minWidth` and `maxHeight` control panel size; overflow is hidden and scrollbars are handled by `ListView`.

## Usage Examples

### Simple environment selector (tree-based)

```tsx
import React, { useMemo, useState } from 'react'
import {
  ListViewDropdown,
  type ListViewItemData,
  IconSelect
} from 'electron-core-ui/renderer'

interface EnvironmentItem {
  id: string
  name: string
  icon?: { type: 'emoji' | 'codicon' | 'none'; value: string }
  children?: EnvironmentItem[]
}

const buildItems = (envs: EnvironmentItem[]): ListViewItemData[] =>
  envs.map((env) => ({
    id: env.id,
    title: env.name,
    isExpandable: (env.children?.length ?? 0) > 0,
    children: env.children ? buildItems(env.children) : [],
    leftActions: env.icon ? <IconSelect value={env.icon} readonly /> : undefined
  }))

const EnvironmentSelector: React.FC<{ environments: EnvironmentItem[] }> = ({ environments }) => {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<string[]>(() =>
    environments.map((e) => e.id)
  )

  const items = useMemo(() => buildItems(environments), [environments])
  const selectedEnv = environments.find((e) => e.id === selectedId) ?? environments[0]

  return (
    <ListViewDropdown
      items={items}
      rootRole="tree"
      menuAriaLabel="Environment selector"
      selectedIds={selectedId ? [selectedId] : []}
      expandedIds={expandedIds}
      buttonProps={{
        secondary: true,
        options: {
          ariaLabel: 'Select environment',
          title: 'Select environment'
        }
      }}
      buttonContent={
        <>
          {selectedEnv?.icon && (
            <IconSelect value={selectedEnv.icon} readonly style={{ marginRight: 4 }} />
          )}
          <span style={{ marginRight: 4, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {selectedEnv?.name ?? 'No environment'}
          </span>
          <i className="codicon codicon-chevron-down" />
        </>
      }
      onItemClick={(payload) => {
        setSelectedId(payload.item.id)
      }}
      onItemToggle={(payload, expanded) => {
        const id = payload.item.id
        if (!id) return
        setExpandedIds((prev) =>
          expanded ? Array.from(new Set([...prev, id])) : prev.filter((existingId) => existingId !== id)
        )
      }}
    />
  )
}
```

### Flat dropdown list

```tsx
import React, { useState } from 'react'
import {
  ListViewDropdown,
  type ListViewItemData
} from 'electron-core-ui/renderer'

const items: ListViewItemData[] = [
  { id: 'light', title: 'Light Theme' },
  { id: 'dark', title: 'Dark Theme' }
]

const ThemeDropdown: React.FC = () => {
  const [selectedId, setSelectedId] = useState<string>('dark')

  return (
    <ListViewDropdown
      items={items}
      rootRole="list"
      menuAriaLabel="Theme"
      selectedIds={[selectedId]}
      buttonProps={{
        options: { ariaLabel: 'Select theme', title: 'Select theme' }
      }}
      buttonContent={<span>{selectedId === 'dark' ? 'Dark Theme' : 'Light Theme'}</span>}
      onItemClick={(payload) => {
        setSelectedId(payload.item.id)
      }}
    />
  )
}
```

## Notes for AI Usage

- Always keep the **list data controlled** by the parent: treat `items`, `selectedIds` and `expandedIds` as derived state from your domain model instead of mutating them inside callbacks.
- Prefer stable `items` references (e.g. memoize the tree with `useMemo`) so that expansion and selection logic in `ListView` do not re-initialize unnecessarily on each render.
- Use `rootRole="tree"` for hierarchical structures (projects, environments, folders) and `rootRole="list"` for flat menus; this helps AI agents and accessibility tooling infer the correct semantics.
- When designing higher-level abstractions (e.g. an environment selector service), keep the mapping `domain model -> ListViewItemData[]` in a small pure function that is easy to reuse and test, instead of scattering `ListViewItemData` construction across components.
