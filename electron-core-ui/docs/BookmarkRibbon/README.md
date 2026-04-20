# BookmarkRibbon

Signet-shaped tag that hangs from the top of its positioned ancestor. Idle state shows a narrow vertical colour strip; hovering (or clicking to open the editor tooltip) unfurls the ribbon downward and reveals the label rotated 90° clockwise. Click opens a rename / recolour / remove tooltip.

`<BookmarkRibbon>` is usually composed inside `<BookmarkRibbonStack>`, which lays out a leading `[+]` add slot followed by one ribbon per tag at the top-right of any positioned container.

## Usage

```tsx
import { BookmarkRibbonStack, type BookmarkRibbonTag } from 'electron-core-ui/renderer'

function FolderHeader({ tags, setTags }: { tags: string[]; setTags: (next: string[]) => void }) {
  const ribbons: BookmarkRibbonTag[] = tags.map((label) => ({ label }))
  return (
    <div style={{ position: 'relative', paddingTop: 40 }}>
      <BookmarkRibbonStack
        tags={ribbons}
        onRename={(index, next) => setTags(tags.map((t, i) => (i === index ? next : t)))}
        onRemove={(index) => setTags(tags.filter((_t, i) => i !== index))}
        onAdd={(label) => setTags([...tags, label])}
      />
      {/* rest of the header */}
    </div>
  )
}
```

Because ribbons are `position: absolute`, the **nearest positioned ancestor** decides where they hang from. The stack is preconfigured with `top: -8px; right: 20px` so the top edge of the signet sits flush with the bottom border of a tab header placed above the container. Give the host element `position: relative` and enough top padding that the ribbons don't overlap your first row of content.

## Components

### `<BookmarkRibbon>`

Single tag. Renders one `<button>` with a clipped `::before` coloured body.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `label` | `string` | required | Visible text. Shown rotated 90° clockwise on hover / open. |
| `color` | `string` | — | Explicit colour (any CSS colour — hex, rgb, hsl). Falls back to `getColorFromString(label)` — a deterministic HSL derived from the label — when omitted. |
| `onRename` | `(next: string) => void` | — | Fired when the rename input commits a *changed* trimmed value. Without this, the rename input still renders but caller doesn't get notified. |
| `onColorChange` | `(hex: string) => void` | — | Fired by the ColorPicker with the newly-picked hex. When omitted, the picker is hidden from the editor tooltip. |
| `onRemove` | `() => void` | — | When provided, the editor tooltip shows a trash button; when omitted, the remove affordance is hidden. |
| `className` | `string` | — | Extra class appended to the root button. |
| `data-testid` | `string` | — | Root gets the id; tooltip sub-elements get `${id}-tooltip`, `${id}-rename-input` (the inner `<input>` is `${id}-rename-input-input` — InputBox's passthrough), `${id}-color-picker`, `${id}-remove`. |

### `<BookmarkRibbonStack>`

Row of ribbons anchored top-right of the positioned ancestor, starting with a muted `[+]` add slot.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `tags` | `BookmarkRibbonTag[]` | required | One entry per ribbon. `{ label: string; color?: string }`. |
| `onRename` | `(index: number, next: string) => void` | — | Forwarded from the per-ribbon `onRename`, partial-applied with the tag's position in `tags`. |
| `onColorChange` | `(index: number, hex: string) => void` | — | Same, forwarded from the per-ribbon ColorPicker. Passing this prop is also what decides whether the stack forwards an `onColorChange` down to each ribbon, so omit it if recolouring isn't supported (which in turn hides the ColorPicker from each ribbon's editor tooltip). |
| `onRemove` | `(index: number) => void` | — | Same, forwarded from the per-ribbon trash button. |
| `onAdd` | `(label: string) => void` | — | Fired when the `[+]` editor commits a non-empty trimmed name. |
| `className` | `string` | — | Extra class on the stack root. |
| `data-testid` | `string` | — | Root gets `${id}`; add button `${id}-add`; add tooltip `${id}-add-tooltip`; add input container `${id}-add-input` (input element `${id}-add-input-input`); confirm button `${id}-add-confirm`; each ribbon `${id}-ribbon-${index}` and its own tooltip subtestids underneath. |

### `BookmarkRibbonTag`

```ts
interface BookmarkRibbonTag {
  label: string
  color?: string
}
```

## Behaviour

- **Idle height** is `30px`. A `min-height: 30px` floor keeps the hover state from visibly shrinking for short labels.
- **Hover / open** (`:hover`, `.ecui-bookmark-ribbon--open`, `:focus-visible`) switches to `height: auto` with `overflow: visible`. The label lives in normal flow with `writing-mode: vertical-rl`, so its rotated glyph height drives the ribbon's total height: `"pet"` → short ribbon; `"user-management"` → much taller.
- **Shape** is a rectangle with a 7 px V-notch cut upward from the bottom centre, producing two pointed tails — the classic signet silhouette. The notch depth is constant regardless of total height, so the tails stay the same size as the body extends.
- **Colour** is applied via a CSS custom property (`--bookmark-color`) read by the `::before` pseudo that renders the silhouette. The label colour is the result of `getContrastColor(effectiveColor)` so it stays readable on any tag colour.
- **`[+]` add slot** keeps its `30px` footprint on hover (no label to drive height) and renders a small `codicon-add` glyph centred in the rectangle.

## Accessibility

- Each ribbon is a `<button>` with `aria-label="Tag: <label>"` and `aria-expanded` reflecting whether its editor tooltip is open.
- The `[+]` button is labelled `Add tag`.
- `:focus-visible` renders a 1 px outline offset by 2 px — visible for keyboard users, suppressed after mouse interactions.

## Examples

### Tags without recolouring

```tsx
<BookmarkRibbonStack
  tags={[{ label: 'api' }, { label: 'beta' }]}
  onRename={handleRename}
  onRemove={handleRemove}
  onAdd={handleAdd}
/>
```

Omitting `onColorChange` hides the colour picker from each ribbon's editor tooltip.

### Read-only display

```tsx
<BookmarkRibbonStack tags={[{ label: 'readonly', color: '#888' }]} />
```

With no `onRename`, `onColorChange`, `onRemove`, or `onAdd`, ribbons still open their editor tooltip on click (so users can inspect the current colour), but none of the controls fire callbacks.
