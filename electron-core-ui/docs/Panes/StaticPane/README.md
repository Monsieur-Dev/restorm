# StaticPane

A single, non-collapsible pane that mirrors the visual style of `SplitView`'s `Pane` header (uppercase title, optional right-aligned actions) but renders in natural document flow — no sash, no resize, no ratio juggling. Each pane sizes to its content; stacking several in a flex column produces a document-style list of named sub-sections that push each other down when their content grows.

## When to use

- A configuration panel with a few named sub-sections whose heights change as the user adds / removes rows.
- Any UI where you want the visual consistency of `SplitView` panes but without the interactive sash between them.

If you need collapse, drag-resize, or flex-basis ratios, use `SplitView` + `Pane` instead.

## Usage

```tsx
import { StaticPane, Button, KeyValueTable } from 'electron-core-ui/renderer'

<StaticPane
  title="Produced headers"
  headerActions={<Button small icon="add" onClick={addRow} />}
  data-testid="produced-headers-pane"
>
  <p>Short hint describing the section…</p>
  <KeyValueTable /* … */ />
</StaticPane>

<StaticPane title="Expiration (seconds)">
  <InputBox /* … */ />
</StaticPane>
```

Stack several of them inside a normal flex column for the pane-stack look.

## Props

```ts
export interface StaticPaneProps {
  /** Uppercase section header label. */
  title?: React.ReactNode
  /**
   * Actions area rendered on the right side of the header — always at
   * full opacity (no idle dimming). Use for an "Add row" `+`, an inline
   * toggle, etc.
   */
  headerActions?: React.ReactNode
  children?: React.ReactNode
  className?: string
  /** Optional test id applied to the pane root element. */
  'data-testid'?: string
}
```

## Behavior

- The pane root is `display: flex; flex-direction: column` — children of `children` flow vertically with an 8px gap.
- The header uses the same theme tokens (`--sideBarSectionHeader-background`, `--foreground`) as `SplitView`'s pane header, so a `StaticPane` stack blends seamlessly with a neighbouring `SplitView`.
- Unlike `SplitView`'s pane, which dims its `headerActions` to 50% opacity until the pane is hovered, a static pane keeps them at full opacity at all times — static panes are typically used where the action is the primary affordance.
- The pane body has `padding: 8px` and `gap: 8px`. Override with a custom `className` or inline wrappers if you need a different rhythm.
