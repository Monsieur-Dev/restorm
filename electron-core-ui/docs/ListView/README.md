# ListView Component

## Overview

`ListView` is a hierarchical list/tree component used to render file trees and sticky headers in the demo project.  
It supports keyboard navigation, drag and drop, sticky headers, and both controlled and uncontrolled selection.

## API

### Types

```typescript
export type ListViewSelectionMode = 'single' | 'multiple'
export type ListViewDropPosition = 'before' | 'after' | 'into'

export interface ListViewItemData {
  id: string
  title?: React.ReactNode
  icon?: React.ReactNode | string
  children?: ListViewItemData[]
  isExpanded?: boolean
  isExpandable?: boolean
  isSelectable?: boolean
  isStickyHeader?: boolean
  data?: unknown
}

export interface ListViewItemPath {
  ids: string[]
  indices: number[]
}

export interface ListViewItemEventPayload {
  item: ListViewItemData
  path: ListViewItemPath
}

export interface ListViewDropEventPayload extends ListViewItemEventPayload {
  source: ListViewItemData
  sourcePath: ListViewItemPath
  position: ListViewDropPosition
  originalEvent: React.DragEvent<HTMLDivElement>
}

export interface ListViewProps {
  items?: ListViewItemData[]
  children?: React.ReactNode
  className?: string
  style?: React.CSSProperties
  selectedIds?: string[]
  activeId?: string | null
  selectionMode?: ListViewSelectionMode
  rootRole?: 'list' | 'tree'
  ariaLabel?: string
  onItemClick?: (payload: ListViewItemEventPayload, event: React.MouseEvent<HTMLDivElement>) => void
  onItemDoubleClick?: (payload: ListViewItemEventPayload, event: React.MouseEvent<HTMLDivElement>) => void
  onSelectionChange?: (selectedIds: string[], payload: ListViewItemEventPayload) => void
  onItemToggle?: (
    payload: ListViewItemEventPayload,
    expanded: boolean,
    event: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>
  ) => void
  onItemDrop?: (payload: ListViewDropEventPayload) => void
  onItemContextMenu?: (payload: ListViewItemEventPayload, event: React.MouseEvent<HTMLDivElement>) => void
}

export interface ListViewItemProps {
  id?: string
  title?: React.ReactNode
  icon?: React.ReactNode | string
  isExpanded?: boolean
  isExpandable?: boolean
  isSelectable?: boolean
  isStickyHeader?: boolean
  data?: unknown
  children?: React.ReactNode
}
```

## Usage (data-driven)

```tsx
import React, { useState } from 'react'
import { ListView, type ListViewItemData } from 'electron-core-ui/renderer'

const items: ListViewItemData[] = [
  {
    id: 'root',
    title: 'Workspace',
    isStickyHeader: true,
    children: [
      { id: 'src', title: 'src', isExpandable: true },
      { id: 'README.md', title: 'README.md', data: { filePath: 'README.md' } }
    ]
  }
]

const FileTree: React.FC = () => {
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  return (
    <ListView
      items={items}
      selectedIds={selectedIds}
      rootRole="tree"
      ariaLabel="Project files"
      onSelectionChange={(ids) => {
        setSelectedIds(ids)
      }}
      onItemClick={(payload) => {
        const filePath = (payload.item.data as { filePath?: string } | undefined)?.filePath
        if (filePath) {
          // open file…
        }
      }}
    />
  )
}
```

## Behavior

- **Data or JSX**: you can either pass an `items` tree, or use JSX children (`<ListViewItem>`).
- **Sticky headers**: any item with `isStickyHeader: true` will stick to the top while scrolling.
- **Expandable folders**:
  - `isExpandable` forces a chevron even when `children` is empty.
  - `isExpanded` controls initial open/closed state.
- **Selection**:
  - `selectionMode` controls single vs multiple selection.
  - `selectedIds` + `onSelectionChange` allow controlled selection.
- **Drag and drop**:
  - `onItemDrop` receives both source and target, plus position (`before` / `after` / `into`).

## Notes for AI Usage

- Prefer **pure data trees** (`ListViewItemData[]`) over JSX when integrating with backends or IPC, since they are easy to serialize and diff.
- Use the `data` field to attach stable metadata (like `filePath`, ids, etc.) instead of encoding those values in `id` or `title`.
- When implementing complex drag/drop logic, handle all structural updates in a **pure helper** (e.g. `updateListAfterDrop`) and call it from `onItemDrop`; avoid mutating the `items` array in place.
