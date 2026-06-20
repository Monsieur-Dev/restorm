import React from 'react'

/**
 * Selects which brand glyph variant to render.
 *
 * - `'contour'`    — R + bolt inside the rounded-rect frame outline (U+F102)
 * - `'no-contour'` — R + bolt, no frame (U+F101)
 */
export type BrandIconVariant = 'contour' | 'no-contour'

export interface BrandIconProps {
  /** Which glyph variant to show (default: 'no-contour') */
  variant?: BrandIconVariant
  /** Font size in pixels (default: 16). Ignored when `style.fontSize` is set. */
  size?: number
  /** Additional CSS class */
  className?: string
  /** Optional inline style overrides. `fontSize` here takes precedence over `size`. */
  style?: React.CSSProperties
  /** Optional test id */
  'data-testid'?: string
}

/**
 * Renders the restorm brand logo as an icon-font glyph so it scales with text
 * and inherits `currentColor` (adapts to dark/light themes without a separate
 * image asset).
 *
 * The underlying font is `restorm-brand`, loaded globally via
 * `src/renderer/assets/fonts/restorm-brand.css`. The glyphs live at Private Use
 * Area codepoints (U+F101–F102) so the literal "R" character is never affected.
 *
 * Usage:
 *   <BrandIcon />                        // no-contour, 16 px
 *   <BrandIcon variant="contour" />      // with rounded-rect frame outline
 *   <BrandIcon size={24} />              // larger
 */
export const BrandIcon: React.FC<BrandIconProps> = ({
  variant = 'no-contour',
  size = 16,
  className,
  style,
  'data-testid': dataTestId,
}) => {
  const glyphClass = `restorm-brand-restorm-logo-${variant}`
  const rootClass = ['restorm-brand', glyphClass, className].filter(Boolean).join(' ')
  const resolvedStyle: React.CSSProperties = {
    fontSize: size,
    ...style,
  }

  return (
    <i
      className={rootClass}
      style={resolvedStyle}
      aria-hidden="true"
      {...(dataTestId ? { 'data-testid': dataTestId } : {})}
    />
  )
}

export default BrandIcon
