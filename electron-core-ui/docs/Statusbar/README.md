# Statusbar Component

## Overview

`Statusbar` and `StatusbarElement` render a styled status bar at the bottom of the window.
They are used to display small pieces of state (ready, warnings, errors, notifications,
environment / selection chips, popover triggers) with optional icons, background tints,
tooltips, and click handlers.

## API

### Types

```typescript
import type { Icon } from 'electron-core-ui/types'

export interface StatusbarProps {
  children?: React.ReactNode
  className?: string
  id?: string
  'data-testid'?: string
}

export interface StatusbarElementProps {
  /** Optional label rendered to the right of the icon. Pass a plain
   *  string, or any ReactNode for custom markup. */
  title?: string | React.ReactNode

  /** Optional icon rendered at the left edge, sized to 16 px and
   *  routed through `IconView` so codicons / emojis / library icons
   *  all land at the same vertical rhythm regardless of font metrics. */
  icon?: Icon | null

  /** Optional background color (e.g. env swatch). When set, the cell
   *  also overrides its foreground via `getContrastColor` so label
   *  and icon stay legible on any hue. */
  backgroundColor?: string

  /** Semantic kinds. Apply theme bg/foreground tokens; ignored when
   *  `backgroundColor` is set. */
  warning?: boolean
  error?: boolean

  /** Dim the cell (~50 % opacity) and suppress `onClick`. Use when
   *  the action exists but isn't currently actionable. */
  disabled?: boolean

  /** Absolutely-positioned ReactNode rendered on top of the cell
   *  (cell is already `position: relative`). Intended for small
   *  overlays like the notification bell's unread-dot badge. */
  overlay?: React.ReactNode

  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void
  className?: string
  id?: string

  /** Tooltip content. Rendered inside a `<Tooltip>` portal anchored
   *  to the cell. Set `tooltipTrigger` to control open behavior. */
  children?: React.ReactNode

  /** How the tooltip / popover attached via `children` opens.
   *  - `'hover'` (default): 300 ms hover-open, small leave-close delay.
   *  - `'click'`: toggle on cell click, close on outside click /
   *    Escape, clicks inside the tooltip content are allowed. */
  tooltipTrigger?: 'hover' | 'click'

  /** Forwarded to `<Tooltip>`'s `placement`. `'auto'` prefers above,
   *  falls back below; `'above'` / `'below'` pin the direction. */
  tooltipPlacement?: 'auto' | 'above' | 'below'

  /** Activity indicator: increment to fire one ripple animation per
   *  increment. Each new value pushes a fresh wave onto an internal
   *  queue so concurrent pulses stack into a visible train; each
   *  wave self-destructs on `onAnimationEnd`. The wave renders in a
   *  portal anchored on the cell's codicon so it can overflow the
   *  statusbar's clip; a duplicate codicon is painted on top of the
   *  wave to keep the icon anchored. No-op when the cell has no
   *  codicon. */
  pulseSignal?: number

  /** Optional override for the ripple's background color. Accepts any
   *  CSS color value or `var(...)`. Defaults to
   *  `var(--statusBar-prominentBackground, var(--focusBorder))` so
   *  the wave naturally takes the theme's accent. */
  pulseColor?: string

  'data-testid'?: string
}
```

## Usage

### Plain label

```tsx
import { Statusbar, StatusbarElement } from 'electron-core-ui/renderer'

<Statusbar>
  <StatusbarElement title="Ready" />
</Statusbar>
```

### Icon + label cell

```tsx
<StatusbarElement
  icon={{ type: 'codicon', value: 'history' }}
  title="Requests history"
  onClick={openHistory}
/>
```

### Bare-icon cell with an overlay badge

```tsx
<StatusbarElement
  icon={{ type: 'codicon', value: 'bell' }}
  onClick={toggleNotifications}
  overlay={hasUnread
    ? (
      <span style={{
        position: 'absolute',
        right: 4,
        bottom: 2,
        width: 9,
        height: 9,
        borderRadius: '50%',
        background: 'var(--notificationsErrorIcon-foreground)'
      }} />
    )
    : undefined}
/>
```

### Colored cell with auto-contrasted text

```tsx
<StatusbarElement
  icon={env.icon}
  title={env.name}
  backgroundColor={env.color /* ex: '#c75000' */}
  onClick={openEnvPicker}
/>
```

### Click-triggered popover (env picker style)

```tsx
<StatusbarElement
  icon={env.icon}
  title={env.name}
  backgroundColor={env.color}
  tooltipTrigger="click"
  tooltipPlacement="above"
>
  <MyEnvList /* clickable content — clicks inside don't close the popover */ />
</StatusbarElement>
```

A `tooltipTrigger="click"` element is an anchored popover, so it automatically joins the application-wide **one-popover-at-a-time** set via [`useExclusivePopover`](../useExclusivePopover/README.md): opening it closes any other open popover (statusbar or not), and opening another closes it. This needs no prop and no wiring — it is on by default.

Two consequences worth knowing:

- **Do not add your own exclusivity around a `StatusbarElement`.** A host helper rendered inside the popover to reach `closeTooltip` would announce under a second id and close its own host, so the popover would shut the instant it opened. The element already participates; the host adds nothing.
- **`tooltipTrigger="hover"` does not participate.** Hover tooltips are not popovers and are dismissed by pointer movement.

### Disabled (non-actionable) cell

```tsx
<StatusbarElement
  icon={{ type: 'codicon', value: 'history' }}
  title="Requests history"
  disabled={!hasEntries}
  onClick={openHistory /* suppressed while disabled */}
/>
```

### Activity ripple (`pulseSignal`)

Pulse the cell once per increment of `pulseSignal`. The wave renders
in a portal so it overflows the bar; concurrent pulses stack into a
visible train. Use for activity indicators (background work, incoming
requests, auth events, …).

```tsx
const [pulse, setPulse] = useState(0)

useEffect(() => {
  return subscribeToBackendPings(() => { setPulse((p) => p + 1) })
}, [])

<StatusbarElement
  icon={{ type: 'codicon', value: 'mcp' }}
  title="mcp"
  pulseSignal={pulse}
/>
```

Override the wave color when the event has a semantic — e.g. red on
failure regardless of theme accent:

```tsx
const [pulse, setPulse] = useState(0)
const [color, setColor] = useState<string | undefined>(undefined)

const onAuthEvent = (phase: 'started' | 'failed') => {
  setColor(phase === 'failed' ? 'var(--testing-iconFailed)' : undefined)
  setPulse((p) => p + 1)
}

<StatusbarElement
  icon={{ type: 'codicon', value: 'key' }}
  title="auth"
  pulseSignal={pulse}
  pulseColor={color}
/>
```

### `StatusbarMcpIndicator` (embedded MCP server cell)

A ready-made cell for apps that embed the electron-core-ui `McpService`. It
renders an `mcp · <session name>` label (just `mcp` when unnamed), a
click-popover showing the live port + session, and an activity ripple per
served request. Purely presentational — the app feeds it runtime state; the
component owns the rendering + the `statusbar.mcp.*` i18n strings (shipped with
electron-core-ui).

| Prop | Type | Notes |
| --- | --- | --- |
| `enabled` | `boolean` | `false` → renders nothing. |
| `port` | `number \| null` | `null` → renders nothing (port not yet bound). |
| `sessionName` | `string?` | Inline `mcp · <name>`; empty → just `mcp`. |
| `pulseSignal` | `number?` | Bump on each served MCP request to fire one ripple. |
| `rightAligned` | `boolean?` | Take the `margin-left:auto` (right) slot. |

```tsx
import { StatusbarMcpIndicator } from 'electron-core-ui/renderer'

// The app reads its own runtime config + per-request activity and passes them in:
<StatusbarMcpIndicator
  enabled={mcp.enabled}
  port={mcp.port}
  sessionName={mcp.sessionName}
  pulseSignal={requestCount}
/>
```

`data-testid`s: `statusbar-mcp-indicator` (the cell), `statusbar-mcp-popover`
(the popover body), `statusbar-mcp-popover-session` (the session line).

### `StatusbarGitIndicator` (git status entry)

One compound cell for a host that embeds electron-core-ui's `GitService`: a
fixed, untranslated `GIT` label (reads identically in every locale, like the
`mcp` label above) followed by two independently-clickable codicon buttons —
`repo-push` and `repo-pull` — each with its own hover tooltip (translated via
the `statusbar.git.pushTooltip` / `statusbar.git.pullTooltip` i18n keys
shipped with electron-core-ui) and an optional **pastille** (a plain dot,
never a count — see the props table). Purely presentational: the host reads
its own `useGitState()` snapshot, derives the two booleans, and wires the two
click callbacks; visibility (only on a git-backed project) is the host's
decision too — this component doesn't know about `GitState`.

| Prop | Type | Notes |
| --- | --- | --- |
| `pushPending` | `boolean` | Shows the push pastille. Set when there are local changes not yet pushed (uncommitted OR local commits to sweep in). |
| `pullPending` | `boolean` | Shows the pull pastille. Set when a semi-pull (fetch + compare, no merge) detected a newer remote version. |
| `onPush` | `() => void` | Repo-push click. |
| `onPull` | `() => void` | Repo-pull click. |
| `data-testid` | `string?` | Root test id. Default `statusbar-git-indicator`. |

```tsx
import { StatusbarGitIndicator, useGitState } from 'electron-core-ui/renderer'

function GitStatusCell(): JSX.Element | null {
  const { isRepo, status, remoteHasNewerVersion } = useGitState()
  if (!isRepo) return null
  const pushPending = (status?.files.length ?? 0) > 0 || (status?.ahead ?? 0) > 0
  return (
    <StatusbarGitIndicator
      pushPending={pushPending}
      pullPending={remoteHasNewerVersion}
      onPush={openPushModal}
      onPull={runPull}
    />
  )
}
```

`data-testid`s: `statusbar-git-indicator` (the cell), `-label` (the "GIT"
span), `-push` / `-pull` (each action's clickable span), `-push-icon` /
`-pull-icon`, `-push-pastille` / `-pull-pastille` (present only while
pending), `-push-tooltip` / `-pull-tooltip`.

## Behavior

- `Statusbar` lays out its children horizontally; a CSS `gap` + separator
  pseudo-element gives every cell a `1 px` hairline on its right edge.
- `StatusbarElement`:
  - Renders `icon` (left) + `title` (right) as siblings inside the cell.
    Either or both are optional; omitting both gives an empty cell you
    probably don't want.
  - `icon` goes through `IconView` with a fixed `16 × 16 px` wrapper
    (`.statusbar-item-icon`), so the glyph family (codicon, emoji,
    library icon) is invisible to layout.
  - `title` is rendered inside a `.statusbar-item-label` span with
    `line-height: 1`, so text and icon center on the same baseline
    regardless of the parent bar's line-height.
  - `backgroundColor` wins over `warning` / `error` / theme tokens and
    also drives `color` via `getContrastColor` + `borderColor`.
  - `disabled` applies `.statusbar-item--disabled` (opacity 0.5) and
    drops the click handler; hover/tooltip still work.
  - Tooltip:
    - `hover` trigger: 300 ms open, 100 ms close grace on leave, with
      hover-into-tooltip keeping it alive.
    - `click` trigger: toggle on cell click, close on outside click or
      Escape, interactive content inside the tooltip is allowed.
  - Pulse:
    - Driven by `pulseSignal` increments; only fires when `icon.type ===
      'codicon'` (the wave anchors on the codicon's bbox + duplicates
      it on top so the icon stays sharp).
    - Each pulse renders a `<span>` via a `react-dom` portal under
      `document.body` so the wave overflows the statusbar's clip. The
      portal pre-paints a duplicate `<i class="codicon">` on top of
      the wave; its color is snapshotted from the original via
      `getComputedStyle` and pinned with `setProperty(..., 'important')`
      so it matches the statusbar's resolved color even when a theme's
      cascade would otherwise win.
    - The original codicon gains `.statusbar-item--pulsing` while
      ripples are active and its `visibility` flips to `hidden` (kept
      in layout to avoid a width twitch). The portal's duplicate stays
      visible.
    - Each ripple unmounts on its own `onAnimationEnd`, so no DOM is
      left behind after the wave completes (~800 ms).
    - Test ids: `${data-testid}-pulse-portal` on the portal root,
      `${data-testid}-pulse-wave` on each wave span.

## Testing

### `data-testid` API

`Statusbar` and `StatusbarElement` expose stable test hooks via `data-testid` props:

- `Statusbar`: `data-testid` (default: `statusbar`)
  - root attributes: `data-item-count`
- `StatusbarElement`: `data-testid`
  - root attributes: `data-warning`, `data-error`, `data-clickable`,
    `data-has-tooltip`, `data-tooltip-visible`
  - derived ids:
    - icon: `${elementId}-icon`
    - label: `${elementId}-label`
    - tooltip (Tooltip root): `${elementId}-tooltip`

### Selectors (electron-core-ui/testing)

Available helpers:

- `statusbarRootSelector(testId)`
- `statusbarElementSelector(elementId)`
- `statusbarElementLabelSelector(elementId)`
- `statusbarElementTooltipSelector(elementId)`

### Playwright-BDD steps (electron-core-ui/testing/playwright-bdd)

Register steps:

- `defineStatusbarBddSteps(bdd)`

Core steps:

- `Then statusbar {string} should be visible`
- `Then statusbar {string} should have {int} elements`
- `Then statusbar element {string} should have warning {string}`
- `Then statusbar element {string} should have error {string}`
- `Then statusbar element {string} should be clickable {string}`
- `When I hover statusbar element {string}`
- `Then statusbar element {string} tooltip should be visible`
- `When I move mouse away from statusbar element {string}`
- `Then statusbar element {string} tooltip should be hidden`
- `When I click statusbar element {string}`
- `When I press {string} on statusbar element {string}` (e.g. `Enter`, `Space`)

### Tooltip integration

Since `StatusbarElement` uses `Tooltip`, the tooltip root is also addressable as
`${elementId}-tooltip`, and you can additionally reuse tooltip-specific assertions by
registering `defineTooltipBddSteps(bdd)` when needed.

## Notes for AI Usage

- Pass icons through the `icon` prop rather than embedding a raw `<i class="codicon">`
  in `title` — the wrapper CSS only sizes / centers icons routed through `IconView`,
  and otherwise codicon's own font-metric quirks leak through and desync the cell.
- Keep `title` compact and user-facing; move long explanations into `children` for
  the tooltip.
- Use `warning` / `error` for **semantic** states only. Use `backgroundColor` for
  arbitrary tints (env colours, user palettes) — the contrast helper handles the
  foreground for you.
- Reach for `tooltipTrigger="click"` + `tooltipPlacement="above"` for pickers at the
  bottom of the window; the portal handles the `overflow: hidden` the bar applies
  to itself, and clicks inside the tooltip body don't dismiss it so dropdowns /
  lists work naturally.
- `disabled` is the right knob for "action exists but not right now" (e.g. history
  button with zero entries); a missing `onClick` is the right knob for "this cell
  isn't interactive."
