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

### Disabled (non-actionable) cell

```tsx
<StatusbarElement
  icon={{ type: 'codicon', value: 'history' }}
  title="Requests history"
  disabled={!hasEntries}
  onClick={openHistory /* suppressed while disabled */}
/>
```

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
