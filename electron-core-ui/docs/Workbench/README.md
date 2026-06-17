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
  - `onRebuildTab?: (tabId: string, data?: unknown) => EditorTab | null` — receives the optional per-tab `persistedState` round-tripped through the autosave (see below).
  - `onStateRestored?: (tree: WorkbenchTree | null) => void`

#### Switching `workbenchId` on a live mount

`workbenchId` keys the persisted tree, so a host that reuses ONE `EditorWorkbench` across documents — e.g. opening a different file over the current one, without remounting — can simply change `workbenchId`. ECUI detects the change and treats it as a document swap: it re-arms the restore for the new id (so its saved tabs reopen) and empties the tree first, so the previous document's tabs don't linger when the new id has nothing saved. Crucially, the autosave writer is suspended until the new restore completes, so the *previous* tree is never written back under the *new* id (which would corrupt the incoming document's saved workbench). Only a genuine id→id swap triggers this; initial mount (`undefined`→id) and teardown (id→`undefined`) are left to their own paths. If you'd rather force a clean slate, remounting via `key={workbenchId}` also works, at the cost of rebuilding all tab content.

#### Round-tripping per-tab state

Each `EditorTab` may set an opt-in `persistedState?: unknown` field. ECUI captures it on every autosave (parallel array next to `tabIds`) and feeds it back into the second argument of `onRebuildTab(tabId, data)` on restore. Use it for tab-local state that doesn't belong in the tab id — e.g. a Mini browser's current URL, a markdown preview's scroll position, the active sub-tab inside a multi-pane editor. The payload must be JSON-serialisable; ECUI treats it as opaque.

#### Peeking the persisted tabs (`loadWorkbenchTabIds`)

`loadWorkbenchTabIds(workbenchId: string): Promise<string[]>` reads the persisted state and returns every tab id that a mount-time restore would reopen — walking split-pane containers, in document order — **without** rebuilding any tab. Returns `[]` when nothing is persisted.

Use it to decide up front whether a restore will reopen tabs: a consumer that shows an onboarding / empty placeholder can query this on mount and hold the placeholder back when the answer is non-empty, then drop it in once the restore (signalled by `onStateRestored`) has reopened those tabs — avoiding a flash of the empty state during the async restore window. The empty case (`[]`) means there is nothing to wait for, so the placeholder can render immediately.
- Sizing:
  - `onSizesChange?: (nodeId: string, sizes: number[]) => void`
- Tab callbacks / extensibility:
  - `renderTabContent?: (tab: EditorTab) => React.ReactNode`
  - `renderTabTitle?: (tab: EditorTab) => React.ReactNode`
  - `getTabContextMenuItems?: (tab: EditorTab, groupId: string, actions: { close: () => void; closeOthersInGroup: () => void }) => ContextMenuItem[] | undefined`
  - `onGetTabContent?: (tabId: string) => string | undefined`
  - `onDetachToNewWindow?: (tabId: string, groupId: string, cursorX?: number, cursorY?: number) => void`
  - `onWorkbenchTabDropped?: (tabData: { tabId: string; title: string; groupId: string; content?: string; cursorX?: number; cursorY?: number }) => boolean | Promise<boolean>`
  - `getTabNavKey?: (tab: EditorTab) => string | null` — maps a tab to the key it is tracked under in the [`navigationService`](../../src/renderer/services/NavigationService.ts) most-recently-used history (see below).

#### Closing the active tab returns to the most-recently-used tab

When the active tab is closed, `EditorWorkbench` activates the **most-recently-used remaining tab in the same group** (VSCode-style), rather than the adjacent one. It ranks the surviving tabs by their position in `navigationService.getHistory()`, mapping each tab to its history key via `getTabNavKey`. Tabs whose key has no recorded activation (or that return `null`) sort last; if none qualifies, it falls back to the first remaining tab. Omit `getTabNavKey` entirely to keep the plain first-remaining-tab behaviour.

The host owns the tab→key mapping, so the same key it records on activation (`navigationService.navigateTo(key, …)`) is what drives both this close behaviour and any most-recently-used tab switcher built on the same history. Singleton / special tabs that have no underlying item can return their own stable tab id as the key, so they participate in the ordering like any other tab.

#### Imperative handle (`EditorWorkbenchHandle`)

`EditorWorkbench` is a `forwardRef` — attach a ref to reach its imperative API:

- `saveState(): Promise<boolean>` — manually flush the workbench tree to storage.
- `loadState(): Promise<WorkbenchTree | null>` — manually restore from storage.
- `clearState(): Promise<boolean>` — drop the persisted state.
- `setFullscreenTabId(tabId: string | null): void` — maximize a tab into the fullscreen modal (`tabId`), or restore whatever is maximized (`null`). Mirrors a double-click on the tab: same `allowFullscreen` gate, same modal. The maximized and normal views share one React instance — relocated by `appendChild`, never remounted — so no editor / response / scroll state is lost in either direction. Use this to drive maximize from outside the workbench (e.g. wired to the MCP `set_tab_maximized` tool).

#### Maximizing a tab (`allowFullscreen`)

A tab opts into maximize by setting `allowFullscreen: true` on its `EditorTab`. Maximizable tabs respond to a double-click on their tab header (and to `setFullscreenTabId`) by opening their content in a fullscreen [`Modal`](../Modal/README.md). At most one tab across all split panes can be maximized at a time. The maximized state is workbench-wide (owned by `EditorWorkbench`), not per-group.

#### Tab content lives above the split-pane tree

Each tab's content (`renderTabContent(tab)`) is rendered **exactly once**, by `EditorWorkbench`, into a stable per-tab detached host `<div>` — *above* the split-pane group tree. Each `EditorGroupView` only renders an empty slot per tab; the host node is relocated into the current slot (or the fullscreen modal body) with `appendChild`.

The consequence consumers can rely on: a tab keeps its **single React instance** — and therefore all of its state (an in-flight HTTP response, unsaved edits, scroll position, sub-tab selection) — when it is **moved between groups**, dragged to a split, or maximized / restored. None of those is a remount.

The host node carries a `data-tab-host-id="{tabId}"` attribute — a stable hook for debugging or for asserting in tests that a tab kept its instance across a relocation.

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

