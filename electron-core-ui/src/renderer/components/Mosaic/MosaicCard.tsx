import React from 'react'
import { getContrastColor } from '../../utils/colorContrast'
import './mosaic.css'

export interface MosaicCardProps {
  /** Heading rendered at the top of the card, inside the colored
   *  banner. Rendered as an `<h1>`. */
  title: React.ReactNode
  /** Body content. Free-form — typically a paragraph, a list, or a
   *  small composition of inline elements. */
  children: React.ReactNode
  /** Optional background colour of the title banner. Any valid CSS
   *  colour. When omitted, the title sits on the workbench's
   *  `--button-background` token so the banner still feels themed.
   *  When provided, the title text colour auto-picks black or
   *  white via the standards-defined relative-luminance heuristic
   *  (`getContrastColor`) — pass `titleColor` to override that
   *  pick. */
  titleBackgroundColor?: string
  /** Explicit title text colour. When omitted, the colour is
   *  derived from `titleBackgroundColor` for readability (or
   *  falls back to `--button-foreground` when no background was
   *  provided either). */
  titleColor?: string
  /** Optional className appended to the card root. */
  className?: string
  /** Optional test id stamped on the card root. */
  'data-testid'?: string
}

/**
 * `MosaicCard` — themed tile chrome paired with `MosaicLayout`.
 *
 * Wraps its children in an `<article>` with the standard masonry
 * tile chrome (background, border, rounded corners) and declares
 * `break-inside: avoid` so the host masonry never splits the card
 * across columns. The header renders the `title` prop inside a
 * coloured banner whose bottom edge is clipped into a downward
 * chevron — the banner "hangs" off the top of the card with a
 * soft drop shadow tracing the chevron silhouette.
 *
 * Consumers compose any layout they want inside `children` — lists,
 * stats blocks, calls-to-action, illustrations, …
 */
export const MosaicCard: React.FC<MosaicCardProps> = ({
  title,
  children,
  titleBackgroundColor,
  titleColor,
  className,
  'data-testid': dataTestId
}) => {
  const rootClass = ['mosaic-card', className].filter(Boolean).join(' ')
  // Derive the title foreground only when we have an explicit
  // background — otherwise we let the theme's `--button-foreground`
  // token answer through CSS so the banner participates in theme
  // swaps without per-card overrides.
  const resolvedTitleColor = titleColor
    ?? (titleBackgroundColor !== undefined ? getContrastColor(titleBackgroundColor) : undefined)
  const bannerStyle: React.CSSProperties = {}
  if (titleBackgroundColor !== undefined) {
    bannerStyle.backgroundColor = titleBackgroundColor
  }
  if (resolvedTitleColor !== undefined) {
    bannerStyle.color = resolvedTitleColor
  }
  return (
    <article
      className={rootClass}
      data-testid={dataTestId ?? 'mosaic-card'}
    >
      <div className="mosaic-card__banner-wrap">
        <div className="mosaic-card__banner" style={bannerStyle}>
          <h1 className="mosaic-card__title">{title}</h1>
        </div>
      </div>
      <div className="mosaic-card__body">{children}</div>
    </article>
  )
}

export default MosaicCard
