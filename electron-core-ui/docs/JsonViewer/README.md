# JsonViewer Component

An interactive JSON graph viewer built on [jsoncrack-react](https://github.com/AykutSarac/jsoncrack.com). Renders a JSON string as a navigable node-based graph with zoom controls.

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
| `darkTheme` | `boolean` | `true` | Whether to use dark theme |
| `data-testid` | `string` | — | Test ID prefix for E2E selectors |

## Features

- **Zoom controls**: Zoom in, zoom out, and center view buttons in the top-right corner
- **Mouse wheel zoom**: Scroll to zoom in/out (uses non-passive event listener for proper `preventDefault`)
- **Auto-center**: Automatically centers the graph view on mount
- **Dark/light theme**: Matches application theme
- **Lazy-loaded**: The underlying `Graph` component is code-split via `React.lazy` to avoid bundling jsoncrack in the initial load
- **Loading state**: Shows a spinner while the graph component loads

## Test IDs

When `data-testid` is provided (e.g., `"json-viewer"`):

- `{testId}-zoom-in` — Zoom in button
- `{testId}-zoom-out` — Zoom out button
- `{testId}-center-view` — Center view button

## Dependencies

- `jsoncrack-react` — The graph rendering engine (peer dependency of electron-core-ui)
