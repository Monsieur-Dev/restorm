import React from 'react'
import './mosaic.css'

export interface MosaicLayoutProps {
  /** Children rendered inside the masonry. Each top-level child
   *  becomes one tile; typically wrap each in a `<MosaicCard>` but
   *  any element with `break-inside: avoid` (or its `<MosaicCard>`
   *  equivalent) flows correctly. */
  children: React.ReactNode
  /** Target column width in CSS pixels. Browser allocates as many
   *  columns of this width as fit the container, then balances tile
   *  heights between them. Defaults to 340 px. */
  columnWidth?: number
  /** Horizontal gutter between columns, in CSS pixels. Defaults to
   *  20 px. The same value is applied to the bottom margin of each
   *  tile via `--mosaic-column-gap` so the vertical rhythm matches. */
  columnGap?: number
  /** Upper bound on how many columns to ever render. When the
   *  intrinsic tile count is smaller than `maxColumns`, the layout
   *  also caps its `max-width` to `tileCount * (columnWidth + gap) -
   *  gap` so a short tile set sits centred in the viewport instead
   *  of being stretched across an unused wide column band. Defaults
   *  to 4. Set to `Infinity` to disable the cap. */
  maxColumns?: number
  /** Optional className appended to the masonry root. */
  className?: string
  /** Optional test id stamped on the masonry root. */
  'data-testid'?: string
}

/**
 * `MosaicLayout` — a Pinterest-style masonry container.
 *
 * Uses native CSS multi-column flow rather than JS measurement: each
 * direct child tile lands in one column (`break-inside: avoid`), and
 * the browser balances column heights for us. The number of columns
 * adapts to the container width automatically — when there's room
 * for only two columns, the same set of tiles repacks into a taller
 * two-column stack without reordering the source.
 *
 * Tiles flow **column by column**, not row by row: a 5-tile gallery
 * in a 3-column container fills col 1 with tiles 1–2 first, then
 * col 2 with tile 3, then col 3 with tiles 4–5. If a layout that
 * preserves a stable left-to-right reading order is required, pair
 * `MosaicLayout` with a JS-driven order constraint at the call site
 * — by default the masonry favours visual balance over reading
 * order.
 *
 * Pair with `<MosaicCard>` for the matching tile chrome (border,
 * background, padding, title). Any other element with
 * `break-inside: avoid` (or `MosaicCard` itself) works too.
 */
export const MosaicLayout: React.FC<MosaicLayoutProps> = ({
  children,
  columnWidth = 340,
  columnGap = 20,
  maxColumns = 4,
  className,
  'data-testid': dataTestId
}) => {
  // Cap the container's max-width so a small tile count sits centred
  // rather than spreading across an unnecessarily wide band. We need
  // the live child count for that — `React.Children.count` walks the
  // shallow list, which matches what the browser will pack into the
  // masonry. Fragments are intentionally not flattened: the consumer
  // is expected to pass tile elements directly.
  const tileCount = React.Children.count(children)
  const cappedColumns = Math.max(1, Math.min(maxColumns, tileCount || 1))
  const maxWidth = cappedColumns * columnWidth + (cappedColumns - 1) * columnGap

  const rootStyle: React.CSSProperties & Record<string, string> = {
    columnWidth: `${String(columnWidth)}px`,
    columnGap: `${String(columnGap)}px`,
    maxWidth: `${String(maxWidth)}px`,
    '--mosaic-column-gap': `${String(columnGap)}px`
  }

  const rootClass = ['mosaic-layout', className].filter(Boolean).join(' ')

  return (
    <div
      className={rootClass}
      style={rootStyle}
      data-testid={dataTestId ?? 'mosaic-layout'}
      data-tile-count={String(tileCount)}
      data-max-columns={String(cappedColumns)}
    >
      {children}
    </div>
  )
}

export default MosaicLayout
