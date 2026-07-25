# BookmarkRibbon

Signet-shaped bookmark that hangs from the top of its positioned ancestor. Idle state shows a narrow vertical colour strip; hovering (or clicking to open the editor tooltip) unfurls the ribbon downward and reveals the label rotated 90° clockwise. Click opens a rename / recolour / remove tooltip.

`<BookmarkRibbon>` is usually composed inside `<BookmarkRibbonStack>`, which lays out a leading `[+]` add slot followed by one ribbon per bookmark at the top-right of any positioned container.

## Usage

```tsx
import { BookmarkRibbonStack, type Bookmark } from 'electron-core-ui/renderer'

function FolderHeader({ bookmarks, setBookmarks }: { bookmarks: string[]; setBookmarks: (next: string[]) => void }) {
  const ribbons: Bookmark[] = bookmarks.map((label) => ({ label }))
  return (
    <div style={{ position: 'relative', paddingTop: 40 }}>
      <BookmarkRibbonStack
        bookmarks={ribbons}
        onRename={(index, next) => setBookmarks(bookmarks.map((b, i) => (i === index ? next : b)))}
        onRemove={(index) => setBookmarks(bookmarks.filter((_b, i) => i !== index))}
        onAdd={(label) => setBookmarks([...bookmarks, label])}
      />
      {/* rest of the header */}
    </div>
  )
}
```

Because ribbons are `position: absolute`, the **nearest positioned ancestor** decides where they hang from. The stack defaults to `top: 0; right: 20px`; consumers that want the ribbons to extend above the ancestor (e.g. flush with a tab-bar bottom border rendered just above) override `top` to a small negative value from their own CSS. Give the host element `position: relative` and enough top padding that the ribbons don't overlap your first row of content.

## Components

### `<BookmarkRibbon>`

Single bookmark. Renders one `<button>` with a clipped `::before` coloured body.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `label` | `string` | required | Visible text. Shown rotated 90° clockwise on hover / open. |
| `color` | `string` | — | Explicit colour (any CSS colour — hex, rgb, hsl). Falls back to `getColorFromString(label)` — a deterministic HSL derived from the label — when omitted. |
| `editable` | `boolean` | `true` | When `false`, the ribbon is a pure display element: clicking does nothing, no editor tooltip is ever mounted, `aria-expanded` is dropped, and the cursor is `default` instead of `pointer`. Hover still unfurls the label. |
| `onRename` | `(next: string) => void` | — | Fired when the rename input commits a *changed* trimmed value. Without this, the rename input still renders but caller doesn't get notified. Ignored when `editable={false}` (no tooltip). |
| `onColorChange` | `(hex: string) => void` | — | Fired by the ColorPicker with the newly-picked hex. When omitted, the picker is hidden from the editor tooltip. |
| `onRemove` | `() => void` | — | When provided, the editor tooltip shows a trash button; when omitted, the remove affordance is hidden. |
| `className` | `string` | — | Extra class appended to the root button. |
| `data-testid` | `string` | — | Root gets the id; tooltip sub-elements get `${id}-tooltip`, `${id}-rename-input` (the inner `<input>` is `${id}-rename-input-input` — InputBox's passthrough), `${id}-color-picker`, `${id}-remove`. |

### `<BookmarkRibbonStack>`

Row of ribbons anchored top-right of the positioned ancestor, starting with a muted `[+]` add slot.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `bookmarks` | `Bookmark[]` | required | One entry per ribbon. `{ label: string; color?: string }`. |
| `editable` | `boolean` | `true` | When `false`, the stack renders as pure display: the leading `[+]` add ribbon is hidden, no add tooltip is mounted, and each ribbon is delegated to in readonly mode (no click, no editor tooltip). Rename / colour / remove handlers passed alongside are ignored. |
| `onRename` | `(index: number, next: string) => void` | — | Forwarded from the per-ribbon `onRename`, partial-applied with the bookmark's position in `bookmarks`. |
| `onColorChange` | `(index: number, hex: string) => void` | — | Same, forwarded from the per-ribbon ColorPicker. Passing this prop is also what decides whether the stack forwards an `onColorChange` down to each ribbon, so omit it if recolouring isn't supported (which in turn hides the ColorPicker from each ribbon's editor tooltip). |
| `onRemove` | `(index: number) => void` | — | Same, forwarded from the per-ribbon trash button. |
| `onAdd` | `(label: string) => void` | — | Fired when the `[+]` editor commits a non-empty trimmed name. |
| `className` | `string` | — | Extra class on the stack root. |
| `data-testid` | `string` | — | Root gets `${id}`; add button `${id}-add`; add tooltip `${id}-add-tooltip`; add input container `${id}-add-input` (input element `${id}-add-input-input`); confirm button `${id}-add-confirm`; each ribbon `${id}-ribbon-${index}` and its own tooltip subtestids underneath. |

### `Bookmark`

```ts
interface Bookmark {
  label: string
  color?: string
}
```

## Behaviour

- **Idle height** is `30px`. A `min-height: 30px` floor keeps the hover state from visibly shrinking for short labels.
- **Hover / focus / open** is JS-gated rather than `:hover`-driven. The component runs a small state machine — `idle` → `opening` → `open` → `closing` → `idle` — and toggles matching `--opening` / `--open` / `--closing` classes. The CSS rules transition based on those classes, so the entry choreography always plays through to completion before any exit can start; mousing out mid-entry queues a deferred close that fires on the entry's `transitionend`. Once extended, `height: auto` + `overflow: visible` lets the label drive the ribbon's height (label uses `writing-mode: vertical-rl`, so its rotated glyph height drives the total): `"pet"` → short ribbon; `"user-management"` → much taller.
- **Choreography timings** — Entry: height grows over 0.4 s, then label fades in over 0.3 s (0.4 s delay) → total 0.7 s. Exit: 3 s grace period, then label fades out over 0.3 s, then height collapses over 0.4 s → total 3.7 s.
- **Shape** is a rectangle with a 7 px V-notch cut upward from the bottom centre, producing two pointed tails — the classic signet silhouette. The notch depth is constant regardless of total height, so the tails stay the same size as the body extends.
- **Colour** is applied via a CSS custom property (`--bookmark-color`) read by the `::before` pseudo that renders the silhouette. The label colour is the result of `getContrastColor(effectiveColor)` so it stays readable on any bookmark colour.
- **`[+]` add slot** keeps its `30px` footprint on hover (no label to drive height) and renders a small `codicon-add` glyph centred in the rectangle.
- **Mutually exclusive with every other anchored popover.** Both the per-ribbon editor and the `[+]` add popover call [`useExclusivePopover`](../useExclusivePopover/README.md), so opening either one closes any other open popover — another ribbon's editor in the same stack, or an unrelated popover elsewhere in the app — and vice versa. This is automatic; there is no prop to opt in or out. It matters because a popover's own outside-click listener cannot see a mousedown that lands inside a sibling popover (siblings stop propagation to protect themselves), so without it two popovers can sit open at once.

## Accessibility

- Each ribbon is a `<button>` with `aria-label="Bookmark: <label>"` and `aria-expanded` reflecting whether its editor tooltip is open.
- The `[+]` button is labelled `Add bookmark`.
- No focus outline is rendered — the unfurl choreography itself is the focus indicator (driven by `onFocus` / `onBlur` going through the same state machine as `mouseenter` / `mouseleave`). A keyboard user tabbing through the stack sees each ribbon unfurl as it gains focus.

## Examples

### Bookmarks without recolouring

```tsx
<BookmarkRibbonStack
  bookmarks={[{ label: 'api' }, { label: 'beta' }]}
  onRename={handleRename}
  onRemove={handleRemove}
  onAdd={handleAdd}
/>
```

Omitting `onColorChange` hides the colour picker from each ribbon's editor tooltip.

### Read-only display

```tsx
<BookmarkRibbonStack
  bookmarks={[{ label: 'pet' }, { label: 'beta' }]}
  editable={false}
/>
```

Use `editable={false}` when the bookmarks are purely informational — e.g. in a search-result popover or any preview surface where the user shouldn't be renaming or recolouring them. Hover still unfurls the rotated label so the text is discoverable; the `[+]` slot and all editor tooltips are omitted.
