# Tabs Component

## Overview

`Tabs` is a lightweight tab strip used in the demo apps to showcase content areas.  
It mimics editor tabs (underline for active tab, hover colors) and uses `ScrollableElement` for the content area.

## API

### Types

```typescript
export interface Tab {
  id: string
  label: string
  content: React.ReactNode
  closable?: boolean
}

interface TabsProps {
  tabs: Tab[]
  activeTabId?: string
  onTabChange?: (tabId: string) => void
  onTabClose?: (tabId: string) => void
}
```

### Props

- **tabs** (`Tab[]`, required): Tab definitions:
  - **id**: unique key.
  - **label**: text shown in the tab header.
  - **content**: React node rendered in the content area when the tab is active.
  - **closable**: when `true`, shows a close button.
- **activeTabId** (`string`, optional): Controlled active tab id. If omitted, `CustomTabs` manages its own active id.
- **onTabChange** (`(tabId: string) => void`, optional): Called when the user selects a different tab.
- **onTabClose** (`(tabId: string) => void`, optional): Called when the close button of a tab is clicked.

## Usage

```tsx
import React, { useState } from 'react'
import { Tabs, type Tab } from 'electron-core-ui/renderer'

const Example: React.FC = () => {
  const [tabs, setTabs] = useState<Tab[]>([
    { id: 'welcome', label: 'Welcome', content: <div>Welcome content</div> },
    { id: 'settings', label: 'Settings', content: <div>Settings content</div>, closable: true }
  ])
  const [activeId, setActiveId] = useState('welcome')

  return (
    <Tabs
      tabs={tabs}
      activeTabId={activeId}
      onTabChange={setActiveId}
      onTabClose={(tabId) => {
        setTabs(prev => prev.filter(t => t.id !== tabId))
        if (activeId === tabId && tabs.length > 1) {
          setActiveId(tabs[0]?.id ?? '')
        }
      }}
    />
  )
}
```

## Behavior

- Implements a horizontal tab bar with:
  - Active underline using `--tab-activeBorder`.
  - Inactive vs active foreground colors using theme variables.
  - Optional close button per tab (`closable`).
- The content area is wrapped in `ScrollableElement` to provide styled scrollbars.
- When `activeTabId` is not provided, the first tab id is used as an internal default.

## Backwards compatibility

- The previous `CustomTabs` name is still exported as an alias to `Tabs` for existing code.

## Notes for AI Usage

- Prefer creating **pure data** for `tabs` (no inline functions in `content`) and pass components instead, to keep serialization and debugging simple.
- In controlled mode, always keep `activeTabId` **synchronized** with `onTabChange`; otherwise tabs may appear stuck.
- Use stable `id` values (e.g. file paths, logical keys) rather than array indices to avoid issues when reordering or removing tabs.

## Testing

### `data-testid` API

`Tabs` (formerly `CustomTabs`) does not currently expose `data-testid` hooks.

### Recommended approach

For E2E testing, consider:

- Using ARIA attributes (`role="tablist"`, `role="tab"`, `role="tabpanel"`, `aria-selected`).
- Targeting tabs by the `id` from the `tabs` array.
- Using text content selectors for tab labels.
