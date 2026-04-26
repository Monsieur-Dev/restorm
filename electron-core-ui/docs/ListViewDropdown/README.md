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
  /** Optional test id applied to the root element. Defaults to `listviewdropdown`. */
  'data-testid'?: string
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

## Testing

### Test ids

`ListViewDropdown` supports an optional `data-testid` prop (defaults to `listviewdropdown`). When provided, internal test ids are derived:

- Root: `data-testid="{root}"`
- Trigger button: `data-testid="{root}-button"` (unless overridden by `buttonProps['data-testid']`)
- Panel: `data-testid="{root}-panel"`
- ScrollableElement: `data-testid="{root}-scrollable"`
- ListView: `data-testid="{root}-listview"`

### Data attributes

The root element exposes stable state via `data-*` attributes:

- `data-is-open`: `"true" | "false"`
- `data-align`: `"left" | "right"`
- `data-selection-mode`: `"single" | "multiple"`
- `data-root-role`: `"tree" | "list"`
- `data-selected-ids`: `selectedIds` joined with `|`
- `data-expanded-ids`: `expandedIds` joined with `|`

### Selectors (`electron-core-ui/testing`)

- `listViewDropdownRootSelector(testId)`
- `listViewDropdownButtonTestId(testId)`
- `listViewDropdownButtonAnchorSelector(testId)`
- `listViewDropdownPanelSelector(testId)`
- `listViewDropdownScrollableTestId(testId)`
- `listViewDropdownScrollableSelector(testId)`
- `listViewDropdownListViewTestId(testId)`

### Playwright-BDD steps (`electron-core-ui/testing/playwright-bdd`)

Dropdown-specific steps:

- `Then list view dropdown {string} should be visible`
- `Then list view dropdown {string} should be open`
- `Then list view dropdown {string} should be closed`
- `When I toggle list view dropdown {string}`
- `Then list view dropdown {string} panel should be visible`
- `When I close list view dropdown {string} with Escape`
- `When I close list view dropdown {string} by clicking outside`
- `Then list view dropdown {string} button text should be {string}`
- `Then list view dropdown {string} item {string} should be visible`
- `Then list view dropdown {string} selected ids should be {string}`

Reusing internal components (recommended):

- Use `defineButtonBddSteps` for the trigger button (id: `{root}-button`)
- Use `defineScrollableElementBddSteps` for the scrollable wrapper (id: `{root}-scrollable`)
- Use `defineListViewBddSteps` for list interactions inside the panel (id: `{root}-listview`)

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

## Filtering long lists

When the popup contains at least `filterThreshold` items (default **15**, exposed as `DEFAULT_FILTER_THRESHOLD`), a sticky filter row appears at the top of the popup body:

- **Filter input** — auto-focused on open, case-insensitive substring match on the item label. `Esc` clears a non-empty filter; a second `Esc` (with the filter empty) closes the popup.
- **Select all / Deselect all** — only on multi-select dropdowns. They act on the *currently visible* slice, so combined with the filter the user can pick "filter + select all matching".
- **No matches** — when the filter eliminates every row, an italic placeholder is rendered in place of the list.

Per-instance opt-out: pass a `filterThreshold` larger than the item count (e.g. `Number.POSITIVE_INFINITY`).

The shared logic lives in `useFilterableDropdown` (see `hooks/useFilterableDropdown.ts`) and the row UI in `components/DropdownFilterRow`.
