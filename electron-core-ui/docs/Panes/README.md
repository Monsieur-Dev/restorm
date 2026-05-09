# Panes

Pane-family components in `electron-core-ui`. Grouped together because they share the same visual chrome (uppercase header, optional right-aligned actions, the same border + background tokens) and the same conceptual model — a labelled rectangle that holds editor / list / form content.

Reach for these in this order:

| Component | When to use |
| --- | --- |
| [`SplitView`](./SplitView/README.md) | Two or more panes that share a horizontal or vertical axis and need to be resizable by the user (drag a sash between them). |
| [`StaticPane`](./StaticPane/README.md) | A single pane with the same chrome as a `SplitView` pane, sized to its content. Stack several in a flex column when the panes don't need to share a fixed total — each grows / shrinks independently with its content. |
| [`Dock`](./Dock/README.md) | Edge-anchored (`left` / `right` / `top` / `bottom`) collapsible + resizable 2-pane primitive — for sidebars, response panels, console drawers. Owns the geometry, animation, and hover-preview affordance; trigger UI stays with the caller. |

## Why a shared parent

Before this directory existed, `SplitView` and `StaticPane` lived as siblings under `components/` even though `StaticPane` is explicitly visual-mimic of `SplitView`'s `Pane`. A reader who knew about one had no signal that the other existed. Co-locating them under `Panes/` (and any future pane primitive) keeps the family discoverable from a single tree node.

Public exports are unchanged — consumers still import `SplitView`, `Pane`, and `StaticPane` from `electron-core-ui/renderer`. The directory move is internal.
