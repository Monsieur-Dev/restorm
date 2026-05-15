# Tabs

Horizontal tab strip + tab-content panel. Each tab has an `id`, a
`label`, and a `content` React node; the active tab is either driven
by the parent (`activeTabId` + `onTabChange`) or managed internally
when uncontrolled.

```tsx
import { Tabs, type Tab } from 'electron-core-ui/renderer'

const tabs: Tab[] = [
  { id: 'request', label: 'Request', content: <RequestForm /> },
  { id: 'docs',    label: 'Docs',    content: <DocViewer /> },
  { id: 'notes',   label: 'Notes',   content: <NotesEditor /> }
]

<Tabs
  tabs={tabs}
  mountStrategy="lazy-once"
  activeTabId={activeTabId}
  onTabChange={setActiveTabId}
  data-testid="my-tabs"
/>
```

## When each tab's content is mounted

`mountStrategy` picks the trade-off between cold-start cost and
state preservation across switches. Three modes:

| `mountStrategy`     | First render mounts             | Switching from a visited tab    | Switching back to a visited tab | State preserved?      |
|---------------------|---------------------------------|---------------------------------|---------------------------------|------------------------|
| `'active-only'` *(default)* | active tab only         | unmount old + mount new         | mount fresh                    | no — fresh mount each visit |
| `'eager'`           | every tab                       | (no mount — already there)      | (no mount — already there)     | yes                    |
| `'lazy-once'`       | active tab only                 | hide via `visibility:hidden`    | (no mount — kept in DOM)       | yes, after first visit |

Pick `'lazy-once'` when the tab strip exposes heavy content (Monaco
editor, model graph, JSON crack viewer, …) that most users never open
during a given session. The first render only pays for the tab the
user is looking at; the others mount on demand and then stay alive,
so subsequent switches are instant and any in-tab state (scroll
position, in-flight HTTP response, draft text) survives.

`keepMounted: true` is the legacy alias for `'eager'`; `keepMounted:
false` (or unset) is the alias for `'active-only'`. `mountStrategy`
wins when both are passed — prefer the named strategy in new code.

## Other props

- `tabs: Tab[]` — every panel. `Tab` exposes `id`, `label`, `content`,
  optional `closable`, `useScrollableElement` (defaults `true` — wraps
  the panel in `ScrollableElement` for Monaco-style scrollbars),
  `allowFullscreen` (double-click to maximize into a modal), and
  `fullscreenModalTitle`.
- `activeTabId?` / `onTabChange?` — controlled-vs-uncontrolled active
  tab. Uncontrolled defaults to `tabs[0].id`.
- `onTabClose?` — fired by the per-tab close button when `closable`.
- `onTabDoubleClick?` — legacy callback for double-click; prefer
  `allowFullscreen` on the individual tab unless you need the side
  effect.
- `data-testid?` — applied to the root; per-tab content panels get
  `${dataTestId}-tabpanel-${tab.id}` automatically.

## Fullscreen modal

Setting `allowFullscreen: true` on a tab makes double-clicking its
header open the same content in an ECUI `Modal`. The modal renders
the tab's `content` directly (a second React instance — the normal
view stays mounted in the tab strip), so it suits read-only viewers
and self-contained editors. For tab content that needs a single React
instance across the normal/maximized transition (e.g. Monaco with
unsaved buffer state), use the workbench's `set_tab_maximized` flow
instead.
