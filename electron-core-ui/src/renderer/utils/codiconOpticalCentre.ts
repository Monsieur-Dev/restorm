/**
 * Optical centring for codicon glyphs.
 *
 * Flex-centring aligns a glyph's EM BOX, but a codicon's ink is not always
 * centred in it — a paper plane's wide tail, a play triangle's slanted edge —
 * so a geometrically centred glyph can still read as off-centre. These helpers
 * measure the glyph on a canvas, with the codicon font that is ACTUALLY
 * loaded, and return the translation that puts its optical centre on the
 * button's centre.
 *
 * Two centres are computed from the same rasterisation:
 *  - the ink bounding box (what `measureText`'s `actualBoundingBox*` reports);
 *  - the alpha-weighted centroid, i.e. the centre of the ink MASS.
 *
 * The centroid is the one used. For a symmetric glyph the two agree; for an
 * asymmetric one they diverge, and the eye follows the mass — the bounding box
 * of a paper plane is centred while the shape plainly is not.
 */

/** Rasterisation factor: the glyph is measured this many times larger than it
 * renders, so a sub-pixel centre survives the rounding at the end. */
const SUPERSAMPLE = 8

/** Offsets are snapped to this grid, in CSS px, to keep glyph edges on
 * half-pixels rather than blurring them across a boundary. */
const SNAP_PX = 0.5

export interface OpticalOffset {
  /** Horizontal translation, in CSS px, that centres the glyph. */
  dx: number
  /** Vertical translation, in CSS px. */
  dy: number
}

const cache = new Map<string, OpticalOffset | null>()

const snap = (value: number): number => Math.round(value / SNAP_PX) * SNAP_PX

/**
 * Resolve the character a codicon class renders, by reading the `content` the
 * stylesheet puts on its `::before`. Avoids shipping a copy of the name →
 * codepoint table, which would drift from the icon font on every upgrade.
 */
const glyphForIcon = (iconName: string): string | null => {
  if (typeof document === 'undefined') return null
  const probe = document.createElement('i')
  probe.className = `codicon codicon-${iconName}`
  probe.setAttribute('aria-hidden', 'true')
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  probe.style.pointerEvents = 'none'
  document.body.appendChild(probe)
  let content: string
  try {
    content = window.getComputedStyle(probe, '::before').content
  } finally {
    probe.remove()
  }
  const quoted = /^["'](.*)["']$/s.exec(content)
  const glyph = quoted?.[1]
  if (!glyph || glyph.length === 0) return null
  return glyph
}

/**
 * Measure one glyph. Returns `null` whenever the measurement cannot be
 * trusted — no canvas (jsdom), or the codicon font not loaded yet, in which
 * case the browser would silently substitute a fallback face and hand back
 * offsets for the wrong shape.
 */
export const measureCodiconOpticalOffset = (
  iconName: string,
  fontSizePx: number
): OpticalOffset | null => {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null

  const glyph = glyphForIcon(iconName)
  if (glyph === null) return null

  const px = fontSizePx * SUPERSAMPLE
  const canvas = document.createElement('canvas')
  const extent = Math.ceil(px * 2)
  canvas.width = extent
  canvas.height = extent
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  ctx.font = `${px}px codicon`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  const advance = ctx.measureText(glyph).width
  // Every codicon advances exactly one em. Any other advance means the browser
  // substituted a fallback face — the webfont has not resolved yet, or the
  // glyph is not in it — and the ink about to be rasterised would belong to a
  // different shape entirely. Declining leaves the glyph geometrically
  // centred, which is the pre-existing rendering.
  // (`FontFaceSet.check()` is NOT usable as this gate: it answers false here
  // even once the face is loaded and demonstrably in use.)
  if (Math.abs(advance - px) > px * 0.01) return null

  // Draw at a known origin so the CSS box can be reconstructed around it. The
  // codicon face has ascent == 1em and descent == 0, so with `line-height: 1`
  // the line box is exactly 1em tall and its bottom edge IS the baseline.
  const originX = px / 2
  const baselineY = px * 1.5
  ctx.fillStyle = '#ffffff'
  ctx.fillText(glyph, originX, baselineY)

  const { data } = ctx.getImageData(0, 0, extent, extent)
  let weight = 0
  let sumX = 0
  let sumY = 0
  for (let y = 0; y < extent; y += 1) {
    for (let x = 0; x < extent; x += 1) {
      const alpha = data[(y * extent + x) * 4 + 3] ?? 0
      if (alpha !== 0) {
        weight += alpha
        sumX += alpha * (x + 0.5)
        sumY += alpha * (y + 0.5)
      }
    }
  }
  if (weight === 0) return null

  const inkCentreX = sumX / weight
  const inkCentreY = sumY / weight
  // The box the glyph is flex-centred in: the advance width, and the 1em line
  // box sitting on the baseline.
  const boxCentreX = originX + advance / 2
  const boxCentreY = baselineY - px / 2

  return {
    dx: snap((boxCentreX - inkCentreX) / SUPERSAMPLE),
    dy: snap((boxCentreY - inkCentreY) / SUPERSAMPLE)
  }
}

/**
 * Memoised variant — the measurement rasterises a glyph, so it is paid once
 * per icon and size for the lifetime of the window.
 */
export const getCodiconOpticalOffset = (
  iconName: string,
  fontSizePx: number
): OpticalOffset | null => {
  const key = `${iconName}@${fontSizePx}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const measured = measureCodiconOpticalOffset(iconName, fontSizePx)
  // A failure before the font is ready must NOT be cached, or the glyph would
  // stay uncentred for the rest of the session.
  if (measured !== null) cache.set(key, measured)
  return measured
}

/** Test seam: drop the memoised measurements. */
export const clearCodiconOpticalOffsetCache = (): void => { cache.clear() }
