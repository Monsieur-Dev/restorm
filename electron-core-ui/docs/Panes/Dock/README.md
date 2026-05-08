# Dock

Edge-anchored, collapsible, resizable 2-pane layout primitive. The dockable `panel` sits against one of the four container edges (`left` / `right` / `top` / `bottom`); a `Sash` on the inside edge handles drag-to-resize; an optional `panelOverlay` (typically the caller's collapse trigger) renders on top of the panel without inheriting its collapse-time fade. The main content (`children`) fills whatever space the panel doesn't take.

`Dock` is a pure layout primitive — it owns the geometry and the collapse / expand animation, but never renders its own toggle UI. The caller binds a button (or any other affordance) to the imperative `expand` / `collapse` / `toggle` methods on the `DockHandle` ref, or drives the controlled `collapsed` prop directly.

## Anatomy

```
[panel @ size px]    [sash 4 px]    [main fills the rest]
```

When the panel is collapsed it either disappears entirely (`collapsedSize === 0`, the default — pick this when the re-expand trigger lives elsewhere, e.g. a statusbar item) or shrinks to a thin gutter that hosts caller-supplied re-expand UI (`collapsedSize: 32` or so). The sash is unmounted while collapsed so the user can't drag a hidden surface.

For `side: 'right'` and `'bottom'` the flex direction is reversed so the panel lands at the trailing edge while the children render in document order — no need for the caller to rearrange JSX between sides.

## Props

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `side` | `'left' \| 'right' \| 'top' \| 'bottom'` | — | Edge of the container the panel anchors to. |
| `panel` | `ReactNode` | — | Content rendered inside the dockable panel (fades to opacity 0 during collapse). |
| `children` | `ReactNode` | — | Main content area — fills whatever space the panel doesn't take. |
| `panelOverlay` | `ReactNode` | — | Rendered as an absolute child of the panel, exempt from the collapse-time opacity fade. Use for trigger UI (collapse / expand button) that must stay readable through the entire animation. |
| `size` | `number` | — | Controlled size in px along the dock axis. Pair with `onSizeChange` to react to user drags. |
| `defaultSize` | `number` | `240` | Initial size for uncontrolled mode. |
| `onSizeChange` | `(next: number) => void` | — | Fires with the new size on every sash drag pixel. Caller is responsible for any debounce / persistence. |
| `collapsed` | `boolean` | — | Controlled collapsed flag. Pair with `onCollapsedChange`. |
| `defaultCollapsed` | `boolean` | `false` | Initial collapsed for uncontrolled mode. |
| `onCollapsedChange` | `(next: boolean) => void` | — | Fires with the new flag on `expand` / `collapse` / `toggle`, in both controlled and uncontrolled modes. |
| `minSize` | `number` | `120` | Minimum panel size when expanded. |
| `maxSize` | `number` | container − 80 px | Maximum panel size when expanded. The 80 px reserve guarantees the main area never disappears. |
| `collapsedSize` | `number` | `0` | Panel size when `collapsed === true`. `0` unmounts the panel entirely; non-zero keeps the panel mounted at gutter width so the caller's re-expand UI stays visible. |
| `storageKey` | `string` | — | When set, the live `size` and `collapsed` flag are mirrored to `localStorage` under `${storageKey}.size` / `${storageKey}.collapsed`. Reads from storage on mount; writes on every change. |
| `className`, `style`, `data-testid` | — | — | Standard ECUI passthroughs. |

### Imperative API (`DockHandle`)

```ts
interface DockHandle {
  expand(): void
  collapse(): void
  toggle(): void
  setSize(next: number): void
}
```

Bind via `useRef<DockHandle>(null)` and pass as `ref`. The methods respect controlled vs uncontrolled state: in controlled mode they fire `onCollapsedChange` / `onSizeChange` instead of mutating internal state.

## Examples

### Controlled with a caller-provided trigger

```tsx
import { Dock, type DockHandle, Button } from 'electron-core-ui/renderer'
import { useRef, useState } from 'react'

function Workbench() {
  const [collapsed, setCollapsed] = useState(false)
  const [size, setSize] = useState(280)
  const dockRef = useRef<DockHandle>(null)

  return (
    <Dock
      ref={dockRef}
      side="left"
      size={size}
      onSizeChange={setSize}
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
      minSize={180}
      collapsedSize={32}
      panelOverlay={
        <Button
          icon={collapsed ? 'chevron-right' : 'chevron-left'}
          onClick={() => dockRef.current?.toggle()}
          style={{ position: 'absolute', top: 6, right: 8 }}
        />
      }
      panel={<Sidebar />}
    >
      <MainContent />
    </Dock>
  )
}
```

### Uncontrolled with persistence

```tsx
<Dock
  side="bottom"
  defaultSize={200}
  defaultCollapsed
  storageKey="restorm.console-dock"
  panel={<ConsoleLog />}
>
  <MainView />
</Dock>
```

The `storageKey` writes to `localStorage` on every change. Pair with a controlled mode + your own debounce when you need to throttle the writes.

### Multiple docks around a central area

Compose by nesting — each `Dock` owns its own state:

```tsx
<Dock side="bottom" panel={<Console />}>
  <Dock side="left" panel={<Sidebar />}>
    <Dock side="right" panel={<Inspector />}>
      <Editor />
    </Dock>
  </Dock>
</Dock>
```

## Animation

Collapse and expand transitions are owned by `Dock`:

- **Phase 1** — the panel grows to `size + 50 px` over **240 ms** (`cubic-bezier(0.4, 0, 0.2, 1)`).
- **Phase 2** — the panel settles to its target (`collapsedSize` or `size`) over **320 ms** with the same curve.
- **Concurrently**, `.dock__panel-content` fades opacity 1 → 0 over **560 ms** and `.dock__panel` blooms a 5 px drop-shadow toward the main column over the same duration. All three motion tracks finish together so the gesture reads as a single beat.
- **Reversed on expand** — same overshoot + settle + opacity + shadow, just in the opposite direction.
- **Drag isolation** — while the user is actively dragging the sash, `data-dragging="true"` is set on the dock root and every transition is killed so the drag stays 1:1 with the cursor.
- **Reduced motion** — `@media (prefers-reduced-motion: reduce)` skips the transitions entirely; the size and opacity snap straight to their final values.

The `panelOverlay` slot lives in the `.dock__panel-overlay` wrapper, which is a sibling of `.dock__panel-content` (not a descendant). That positioning keeps the overlay at full opacity throughout the animation — essential for the collapse / expand trigger button, which must stay readable while the surrounding panel content fades out.

## Layout invariants

- The panel's size on the dock axis is set via inline `width` (vertical docks) or `height` (horizontal docks) so the parent's flex sizing doesn't fight it.
- The Dock root uses `display: flex` with the appropriate `flex-direction` (`row` / `row-reverse` / `column` / `column-reverse`) for the chosen `side`.
- The Dock and its panel both leave `overflow` at the default (`visible`) so descendants can use `position: sticky` correctly. Callers that want to clip should set `overflow: hidden` on their own panel content wrapper.
- The main area uses `flex: 1 1 auto; min-width: 0; min-height: 0` so its inner ScrollableElement (or any other shrinking child) can resize correctly.

## Accessibility

- The sash is rendered by the existing ECUI `Sash` primitive, which already exposes `role="separator"` + `aria-valuenow / aria-valuemin / aria-valuemax`.
- The collapse trigger UI is supplied by the caller — they own its `aria-label`, `aria-expanded`, and keyboard binding.
- Animations honor `prefers-reduced-motion: reduce`.

## Persistence pattern (recommended)

For dock state that should survive across sessions, prefer a controlled setup driven by `usePersistedState` (or an equivalent caller-owned store) over the built-in `storageKey`. The controlled flow lets the caller debounce the write, namespace the key per project, and migrate the schema when the dock surface changes. The built-in `storageKey` is a convenience for one-off internal panels where every drag pixel hitting `localStorage` is fine.
