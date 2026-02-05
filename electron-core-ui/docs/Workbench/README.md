# Workbench / EditorWorkbench

## Overview

This folder contains:
- `Workbench`: a lightweight wrapper that applies platform/layout classes.
- `EditorWorkbench`: a tree-based editor/tabs workbench with groups, split handling, drag & drop, persistence, and optional multi-window support.

## API

### `Workbench`

- `children: React.ReactNode`
- `className?: string`
- `border?: boolean`
- `fullscreen?: boolean`
- `fontAliasing?: 'auto' | 'antialiased' | 'none'`
- `data-testid?: string` (defaults to `"workbench"`)

### `EditorWorkbench`

- `tree: WorkbenchTree`
- `onChange?: (tree: WorkbenchTree) => void`
- `className?: string`
- `style?: React.CSSProperties`
- `data-testid?: string` (defaults to `"editorworkbench"`)
- Focus:
  - `focusedGroupId?: string | null`
  - `onFocusedGroupChange?: (groupId: string | null) => void`
- Persistence:
  - `workbenchId?: string`
  - `autosave?: boolean`
  - `onRebuildTab?: (tabId: string) => EditorTab | null`
  - `onStateRestored?: (tree: WorkbenchTree | null) => void`
- Sizing:
  - `onSizesChange?: (nodeId: string, sizes: number[]) => void`
- Tab callbacks / extensibility:
  - `renderTabContent?: (tab: EditorTab) => React.ReactNode`
  - `renderTabTitle?: (tab: EditorTab) => React.ReactNode`
  - `getTabContextMenuItems?: (tab: EditorTab, groupId: string, actions: { close: () => void; closeOthersInGroup: () => void }) => ContextMenuItem[] | undefined`
  - `onGetTabContent?: (tabId: string) => string | undefined`
  - `onDetachToNewWindow?: (tabId: string, groupId: string, cursorX?: number, cursorY?: number) => void`
  - `onWorkbenchTabDropped?: (tabData: { tabId: string; title: string; groupId: string; content?: string; cursorX?: number; cursorY?: number }) => boolean | Promise<boolean>`

## Testing

When `data-testid` is provided, `EditorWorkbench` exposes stable hooks for E2E tests.

### data-testid conventions (EditorWorkbench)

Assuming `data-testid = {id}`:

- Root: `{id}`
- Group root: `{id}-group-{groupId}`
- Group content placeholder: `{id}-group-{groupId}-content`
- Tabs (ScrollableElement root): `{id}-group-{groupId}-tabs`
- Tabs container: `{id}-group-{groupId}-tabs-container`
- Tab: `{id}-group-{groupId}-tabs-tab-{tabId}`
- Tab close button: `{id}-group-{groupId}-tabs-tab-{tabId}-close`
- Tabs context menu: `{id}-group-{groupId}-tabs-contextmenu`
- Sash (between container children): `{id}-sash-{nodeId}-{index}` (e.g. `nodeId = root`)

### Stable data attributes

On the `EditorWorkbench` root:
- `data-root-orientation`
- `data-root-group-count`
- `data-focused-group-id`

On each group root (`{id}-group-{groupId}`):
- `data-has-focus`
- `data-active-tab-id`
- `data-tab-count`

### Selectors

Defined in `electron-core-ui/src/main/testing/workbenchSelectors.ts`:

- `editorWorkbenchRootSelector(testId)`
- `editorWorkbenchGroupSelector(testId, groupId)`
- `editorWorkbenchGroupContentSelector(testId, groupId)`
- `editorWorkbenchGroupTabsSelector(testId, groupId)`
- `editorWorkbenchGroupTabsContainerSelector(testId, groupId)`
- `editorWorkbenchTabSelector(testId, groupId, tabId)`
- `editorWorkbenchTabCloseSelector(testId, groupId, tabId)`
- `editorWorkbenchGroupTabsContextMenuSelector(testId, groupId)`
- `editorWorkbenchSashSelector(testId, nodeId, index)`

### Playwright-BDD steps

Defined in `electron-core-ui/src/main/testing/playwright-bdd/workbench.steps.ts`:

- `Then editor workbench {string} should be visible`
- `Then workbench {string} should have {int} groups`
- `Then workbench {string} group {string} should have {int} tabs`
- `Then active tab in workbench {string} group {string} should be {string}`
- `When I activate workbench {string} group {string} tab {string}`
- `When I close workbench {string} group {string} tab {string}`
- `When I open workbench {string} group {string} tab {string} context menu`
- `When I reorder workbench {string} group {string} tab {string} to index {int}`
- `When I drag workbench {string} group {string} tab {string} and drop on group {string} position {string}` (left|right|top|bottom|center)
- `When I move workbench {string} tab {string} from group {string} to group {string} at index {int}`

