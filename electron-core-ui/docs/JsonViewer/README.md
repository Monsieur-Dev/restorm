# JsonViewer Component

An interactive JSON graph viewer built on [@xyflow/react](https://reactflow.dev/). Renders a JSON string as a navigable node-based graph with collapsible composite rows and zoom / fit-view controls.

## Component Location

- Source: `electron-core-ui/src/renderer/components/JsonViewer/JsonViewer.tsx`
- Export: `electron-core-ui/renderer`

## Usage

```tsx
import { JsonViewer } from 'electron-core-ui/renderer'

<JsonViewer json='{"users": [{"name": "Alice"}, {"name": "Bob"}]}' />
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `json` | `string` | *(required)* | JSON string to visualize as a graph |
| `darkTheme` | `boolean` | `true` | Kept for API parity. Currently a no-op — theming reads CSS variables. |
| `data-testid` | `string` | — | Test ID prefix for E2E selectors |

## Features

- **Node graph layout**: Each composite (object / array) becomes a node carrying its property rows; nested composites become child nodes wired by edges.
- **Collapse / expand**: Every composite row has a `+` / `−` toggle (codicons `worktree` / `dash`). Collapsing prunes the subtree from the layout.
- **Zoom + fit controls**: Standard React Flow `<Controls>` panel — same visual as the doc viewer (`ModelGraph`).
- **Smart auto-fit**: First fit on mount + auto-fit after every layout change, *unless* the user has manually panned / zoomed. In that case, the viewport keeps the user's framing and the clicked node is pinned at its previous screen position. Clicking the Fit View button re-arms auto-fit.
- **Animated transitions**: Node positions ease into place (`transform 350ms`) and the viewport's pan / zoom animates with the same duration so the camera arrives on the same beat as the nodes settle.
- **Truncation tooltip**: Long primitive values get an on-hover tooltip showing the full value.
- **Array-of-objects shortcut**: When every element of an array is itself a composite, the intermediate `index → object` node is skipped — the parent row fans out directly to each element.
- **Empty-composite inlining**: `{}` and `[]` render inline as leaf values rather than as separate placeholder nodes.

## Test IDs

When `data-testid` is provided (e.g., `"json-viewer"`):

- `{testId}` — the `ReactFlow` root
- React Flow's built-in Controls are not testid-stamped per button; assert on their `aria-label` (`Zoom in`, `Zoom out`, `Fit view`).

## Dependencies

- `@xyflow/react` — The graph rendering engine. Pulled in directly; no lazy split (the cost is small enough to bundle eagerly).
