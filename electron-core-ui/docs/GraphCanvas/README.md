# GraphCanvas

The single node-graph **surface** for the whole app. `GraphCanvas` wraps
[`@xyflow/react`](https://reactflow.dev)'s `<ReactFlow>` with one consistently
themed control cluster (zoom in / zoom out / fit-to-view, plus an optional
minimap and minimap toggle) and a small set of ready-made **panning presets**, so
every graph a consuming application renders looks and behaves the same way.

It owns the *chrome* of a graph surface — the control bar, the minimap, the
dotted background, the panning/zoom behaviour — and nothing app-specific. Node
and edge content, node/edge types, and any React Flow handler the consumer needs
are passed in via props; `reactFlowProps` is spread **last** so a consumer can
override any underlying React Flow prop the presets don't cover.

## Why it exists

Several graphs in a typical app each grow their own copy of the zoom / fit /
minimap controls and their own panning code, and they drift apart: different
styling on each surface, a minimap on one but not another, and the
popover-safe pan logic copy-pasted into every read-only graph. `GraphCanvas`
collapses all of that into one component:

- **One look.** A dark, theme-variable-driven control cluster (icons stay
  readable on every theme) shared by every surface.
- **One pan implementation.** The pointer-lock pan (cursor disappears so a
  hosting popover doesn't close mid-drag) lives here once, behind a preset.
- **The minimap, everywhere it's wanted.** A single `minimap` prop, optionally
  gated behind a toggle button in the control stack.

## Usage

```tsx
import { GraphCanvas } from 'electron-core-ui/renderer'
import '@xyflow/react/dist/style.css' // (GraphCanvas imports this itself)

<GraphCanvas
  nodes={nodes}
  edges={edges}
  nodeTypes={NODE_TYPES}
  panMode="pointerLock"
  minimap={{ nodeColor: 'var(--focusBorder)' }}
/>
```

### With a persisted viewport, a grid, and a minimap toggle

```tsx
<GraphCanvas
  nodes={nodes}
  edges={edges}
  nodeTypes={NODE_TYPES}
  panMode="editor"
  background={{ id: graphId, gap: 20, offset: 20 }}
  minimap={{ nodeColor: (n) => n.data.color ?? '#a855f7' }}
  minimapToggle={{ label: t('graph.minimap.toggle'), testId: 'graph-minimap-toggle' }}
  defaultViewport={savedViewport}
  reactFlowProps={{
    onNodesChange,
    onEdgesChange,
    onConnect,
    snapToGrid: true,
    snapGrid: [20, 20]
  }}
/>
```

### Read-only thumbnail (no controls, no interaction)

```tsx
<GraphCanvas nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} panMode="static" />
```

## Panning presets (`panMode`)

| Mode | Drag | Wheel | Use it for |
| --- | --- | --- | --- |
| `'editor'` | left-drag rubber-band selects; **middle** mouse pans | plain wheel zooms | a live, editable graph editor |
| `'classic'` | plain left-drag pans | plain wheel zooms | a docked, read-only panel with no popover to keep alive |
| `'pointerLock'` | left-drag pans with the cursor hidden (popover-safe) | **Ctrl/⌘ + wheel** zooms (plain wheel scrolls the page) | a graph hosted inside a hover popover / tooltip |
| `'static'` | none | none | an inert fit-to-view thumbnail (also forces controls off) |

**Why `'editor'` disables the Shift-selection key:** React Flow's default
`selectionKeyCode='Shift'` registers a window-level `keydown` listener that calls
`preventDefault()` on every Shift press. On Linux that `preventDefault` on a bare
modifier wedges Chromium into a composition-like state that swallows the next
printable character — so the first letter of every capital is eaten in every text
field on the page. The `editor` preset sets `selectionKeyCode={null}` (removing the
listener) and moves rubber-band selection to left-drag and panning to the middle
mouse button instead.

**Why `'pointerLock'` exists:** React Flow's built-in `panOnDrag` reads
`clientX/Y` through d3-zoom, and those freeze the moment the pointer is locked.
The preset turns `panOnDrag` off and drives the viewport from Pointer-Lock
`movementX/Y` deltas instead. The cursor disappears for the duration of the drag,
so a popover hosting the graph never registers a `mouseleave` mid-pan and stays
open. (A `setPointerCapture` fallback keeps the drag working even if the lock
request is denied.)

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `nodes` | `Node[]` | — | React Flow nodes. |
| `edges` | `Edge[]` | — | React Flow edges. |
| `nodeTypes` | `NodeTypes` | — | Custom node renderers. |
| `edgeTypes` | `EdgeTypes` | — | Custom edge renderers. |
| `panMode` | `'editor' \| 'classic' \| 'pointerLock' \| 'static'` | `'classic'` | Panning / zoom preset (see above). |
| `showControls` | `boolean` | `true` | Show the zoom / fit control bar (forced off when `panMode === 'static'`). |
| `background` | `boolean \| { gap?, offset?, id? }` | `false` | Dotted background grid. Pass a unique `id` per mounted canvas (React Flow derives its `<pattern>` id from it). |
| `minimap` | `false \| { nodeColor?, pannable?, zoomable? }` | `false` | Minimap. Shown when truthy (and toggled on, if `minimapToggle` is set). |
| `minimapToggle` | `{ label: string; testId?: string }` | — | Adds a toggle button at the bottom of the control stack. **The `label` is passed by the consumer** so the library stays locale-free. Requires `minimap`. |
| `extraControls` | `ReactNode` | — | Extra `<ControlButton>`s appended to the control stack. |
| `fitView` | `boolean` | — | Fit the graph to the viewport on mount. |
| `fitViewOptions` | `FitViewOptions` | — | Options shared by the auto-fit and the Fit View button. |
| `defaultViewport` | `Viewport` | — | Initial pan/zoom (e.g. persisted). Wins over `fitView`. |
| `minZoom` / `maxZoom` | `number` | — | Zoom bounds. |
| `reactFlowProps` | `Partial<ReactFlowProps>` | — | Escape hatch — spread **last** onto `<ReactFlow>`. Use it for handlers, perf flags (`onlyRenderVisibleElements`), `nodesDraggable`, context-menu callbacks, etc. |
| `children` | `ReactNode` | — | Slot for app-specific overlays rendered inside `<ReactFlow>`. |
| `withoutProvider` | `boolean` | `false` | Skip the built-in `<ReactFlowProvider>`. Set this when the consumer mounts its own provider (so it can call `useReactFlow()` from a sibling for fit-view / focus). |
| `data-testid` | `string` | — | Stamped on the canvas wrapper. |

### `withoutProvider` and `useReactFlow()`

`GraphCanvas` mounts its own `<ReactFlowProvider>` by default, so you can drop it
anywhere. If you need `useReactFlow()` access (`fitView`, `getNode`, `setCenter`,
…) from a component **outside** the `GraphCanvas` subtree — e.g. to expose an
imperative `focus(id)` handle, or to run an auto-fit effect — mount your own
`<ReactFlowProvider>` around both that component and the canvas, and pass
`withoutProvider` so the providers don't nest:

```tsx
<ReactFlowProvider>
  <MyCanvas /> {/* calls useReactFlow(), renders <GraphCanvas withoutProvider … /> */}
</ReactFlowProvider>
```

## Styling

The control + minimap chrome is themed entirely from workbench CSS variables in
`graphCanvas.css`, scoped to the `.ecui-graph-canvas` wrapper class, so it rides
with the component wherever it is mounted and needs no per-theme hand-tuning. A
consumer can override the active-toggle accent (or any other rule) by targeting
`.ecui-graph-canvas` from its own stylesheet.
