# Mosaic

A Pinterest-style masonry layout (`MosaicLayout`) with a matching
themed tile component (`MosaicCard`). Tiles of mixed heights pack
into vertical columns without leaving the column gaps a CSS grid
would, and the column count adapts to container width without JS
measurement.

## When to use

- Landing surfaces (empty-state pages, dashboards) where the
  rendered content is a heterogeneous set of self-contained tiles
  (a CTA card, a recent-activity feed, a per-resource summary,
  tips, …).
- Anywhere a `CSS Grid` would leave conspicuous vertical gaps
  because adjacent cells differ a lot in height.

Not appropriate when the tile order matters horizontally — masonry
flows column-by-column, so the "third tile" in your source ends up
at the **top of column 3** in a wide layout, but **mid-column 1**
in a narrow one.

## Quick usage

```tsx
import { MosaicLayout, MosaicCard } from 'electron-core-ui/renderer'

export const Landing = () => (
  <MosaicLayout columnWidth={340} columnGap={20} maxColumns={4}>
    <MosaicCard title="Import data">
      <p>Bring in an OpenAPI spec, a curl command, …</p>
      <button>Import…</button>
    </MosaicCard>
    <MosaicCard title="Recent activity">
      <ul>{/* … */}</ul>
    </MosaicCard>
    <MosaicCard title="Tips & tricks">
      <ul>{/* … */}</ul>
    </MosaicCard>
  </MosaicLayout>
)
```

## `MosaicLayout` props

| Prop          | Type              | Default | Notes |
|---------------|-------------------|---------|-------|
| `children`    | `React.ReactNode` | —       | One element per tile (any element with `break-inside: avoid`). |
| `columnWidth` | `number`          | `340`   | CSS pixels. The browser allocates as many columns of this width as fit, then balances column heights. |
| `columnGap`   | `number`          | `20`    | Horizontal gutter in pixels. The same value is applied to the bottom margin of each tile so vertical rhythm matches horizontal rhythm. |
| `maxColumns`  | `number`          | `4`     | Caps the column count. The layout also caps its own `max-width` to `min(maxColumns, tileCount) * (columnWidth + columnGap) - columnGap`, so a 2-tile gallery sits centred instead of spreading across an empty wide band. Pass `Infinity` to disable the cap. |
| `className`   | `string`          | —       | Appended to the root class list. |
| `data-testid` | `string`          | `'mosaic-layout'` | Root test id. |

Root data attributes: `data-tile-count`, `data-max-columns`.

## `MosaicCard` props

| Prop                    | Type              | Default          | Notes |
|-------------------------|-------------------|------------------|-------|
| `title`                 | `React.ReactNode` | —                | Heading rendered inside the coloured banner at the top of the card. Wrapped in an `<h1>`. |
| `children`              | `React.ReactNode` | —                | Body content; free-form. |
| `titleBackgroundColor`  | `string`          | —                | CSS colour for the banner background. When omitted, the banner uses the theme's `--button-background` token. When set, the title text colour auto-picks black or white via `getContrastColor` for legibility. |
| `titleColor`            | `string`          | —                | Explicit title text colour. Use this to override the auto-picked contrast colour when the background has a tricky mid-range luminance. |
| `className`             | `string`          | —                | Appended to the root class list. |
| `data-testid`           | `string`          | `'mosaic-card'`  | Root test id. |

The card root carries `break-inside: avoid` already, so it never
splits across columns inside a `MosaicLayout`. The card body sits
on `--editorWidget-background` with a `--panel-border` outline. The
title banner is clipped into a soft downward chevron and traces a
drop shadow underneath, so each banner reads as a ribbon
"hanging" off the top of the card.

## Layout caveats

- **Tile flow is column-major**, not row-major. The source order is
  preserved when reading top-down within a column then moving to
  the next column — but a given tile's column index changes with
  the container width.
- For a layout that pins specific tiles to specific positions
  regardless of width, use CSS Grid with named areas at the call
  site instead.
- The column-count + `max-width` cap depends on a shallow count of
  `React.Children`. If you wrap tiles in fragments or arrays, the
  count reflects the fragment/array, not its leaves — pass tile
  elements directly for the centring to work.

## Test ids

- `mosaic-layout` (overridable via `data-testid`)
- `mosaic-card` (overridable via `data-testid`)
