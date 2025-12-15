# EditorWorkbench (Tabs) - Usage

Basic example:

```tsx
import React, { useState } from 'react';
import { EditorWorkbench, type WorkbenchState } from 'electron-core-ui/renderer';

const Example = () => {
  const [state, setState] = useState<WorkbenchState>({
    groups: [
      { id: 'g1', tabs: [{ id: 't1', title: 'README.md' }], activeTabId: 't1' },
      { id: 'g2', tabs: [{ id: 't2', title: 'notes.txt' }], activeTabId: 't2' }
    ],
    activeGroupId: 'g1'
  });

  return <EditorWorkbench state={state} onCloseTab={(tabId, groupId) => {
    setState(prev => {
      const groups = prev.groups.map(g => {
        if (g.id !== groupId) return g;
        const tabs = g.tabs.filter(t => t.id !== tabId);
        const activeTabId = g.activeTabId === tabId ? tabs[0]?.id : g.activeTabId;
        return { ...g, tabs, activeTabId };
      });
      return { ...prev, groups };
    });
  }} />;
};
```

Drag and drop is supported across tab bars and reordering within a group. Splitting can be performed by dropping a tab near group edges (left, right, top, bottom).

Detaching a tab outside the window will create a new Electron window (requires the provided preload and main IPC handlers).

# Tabs Component

Declarative VS Code-like Tabs with reorder, fixed tabs, detachable tabs, slim mode, and scroll controls.

## Usage

```tsx
<Tabs slim tabsPosition="bottom" onAttach={({ tabKey }) => {/* attach */}}>
  <Tab title="Tab 1" tabKey="tab1" fixed>
    <ComponentForTab1 />
  </Tab>
  <Tab title="Tab 2" tabKey="tab2" detachable onDetach={({ tabKey }) => {/* detach */}}>
    <ComponentForTab2 />
  </Tab>
</Tabs>
```

## API

- Tabs props:
  - slim?: boolean
  - tabsPosition?: 'top' | 'bottom' | 'left' | 'right'
  - onAttach?: (payload: { tabKey: string }) => void
  - children: ReactNode

- Tab props:
  - title: string
  - tabKey: string
  - children: ReactNode
  - onClosing?: () => boolean
  - closable?: boolean
  - fixed?: boolean
  - detachable?: boolean
  - onDetach?: (payload: { tabKey: string }) => void
  - size?: number

## Behavior

- Reorder: drag a non-fixed tab; drop indicator appears respecting fixed positions.
- Close: middle-click or close button; `onClosing` can veto closure.
- Detach: dragging outside header triggers `onDetach`.
- Attach: dropping external payload with `application/x-demo-tab` triggers `onAttach`.
- Scroll controls: arrows appear when content overflows; mouse wheel scrolls.

## Styles

- Normal: inspired by VS Code multieditortabscontrol.css.
- Slim: inspired by actionbar.css.

Keep visual parity with VS Code variables (tab height, colors).
