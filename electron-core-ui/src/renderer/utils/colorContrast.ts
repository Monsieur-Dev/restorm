/**
 * Returns '#000000' (black) or '#ffffff' (white) — whichever text colour is
 * more *legible* on the given background.
 *
 * Accepts hex (`#rgb`, `#rrggbb`, or no leading `#`), `hsl(h, s%, l%)`, and
 * `rgb()` / `rgba()` — the last being what `getComputedStyle` returns, so a
 * caller can pass a colour read off a rendered element directly.
 *
 * Uses **APCA** (Accessible Perceptual Contrast Algorithm, the WCAG 3 draft
 * successor) rather than the WCAG 2 relative-luminance ratio. WCAG 2 is a poor
 * predictor of *perceived* contrast for saturated mid-tones: it over-weights
 * green and under-weights blue/red, so it picks black text on a saturated
 * coral / teal / magenta where white is visibly cleaner. APCA models
 * perception directly, so those cases resolve to white. We compute the APCA
 * lightness-contrast (Lc) of black text and of white text against the
 * background and keep whichever has the greater magnitude.
 */
export function getContrastColor(color: string): '#000000' | '#ffffff' {
  const rgb = parseColorToRgb(color)
  const bgY = apcaScreenLuminance(rgb)
  // Text is pure black (screen luminance 0) or pure white (1).
  const lcOnBlack = Math.abs(apcaContrast(0, bgY))
  const lcOnWhite = Math.abs(apcaContrast(1, bgY))
  return lcOnWhite > lcOnBlack ? '#ffffff' : '#000000'
}

/** APCA screen luminance: a simple `^2.4` transfer (NOT the WCAG piecewise
 * curve) on the sRGB coefficients. */
function apcaScreenLuminance(rgb: [number, number, number]): number {
  return 0.2126729 * Math.pow(rgb[0], 2.4) +
    0.7151522 * Math.pow(rgb[1], 2.4) +
    0.0721750 * Math.pow(rgb[2], 2.4)
}

/** APCA lightness-contrast (Lc, roughly −108..106) of `text` luminance against
 * `bg` luminance, both APCA screen luminances in [0,1]. Sign encodes polarity
 * (positive = dark text on light bg); callers here only compare magnitudes.
 * Constants are the APCA-W3 0.1.1 "smoothed" set. */
function apcaContrast(textY: number, bgY: number): number {
  const BLACK_CLAMP = 1.414
  const BLACK_THRESHOLD = 0.022
  const DELTA_Y_MIN = 0.0005
  const soft = (y: number): number =>
    y < BLACK_THRESHOLD ? y + Math.pow(BLACK_THRESHOLD - y, BLACK_CLAMP) : y

  const txt = soft(textY)
  const bg = soft(bgY)
  if (Math.abs(bg - txt) < DELTA_Y_MIN) return 0

  const SCALE = 1.14
  if (bg > txt) {
    // Normal polarity: dark text on a lighter background.
    const sapc = (Math.pow(bg, 0.56) - Math.pow(txt, 0.57)) * SCALE
    return sapc < 0.1 ? 0 : (sapc - 0.027) * 100
  }
  // Reverse polarity: light text on a darker background.
  const sapc = (Math.pow(bg, 0.65) - Math.pow(txt, 0.62)) * SCALE
  return sapc > -0.1 ? 0 : (sapc + 0.027) * 100
}

const HSL_RE = /^hsl\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)%\s*,\s*(\d+(?:\.\d+)?)%\s*\)$/i
/** `rgb()` / `rgba()`, in the exact shape `getComputedStyle` hands back — the
 * natural input when the colour is read off a rendered element rather than
 * supplied as a literal. */
const RGB_RE = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*(?:[,/].*)?\)$/i

function parseColorToRgb(color: string): [number, number, number] {
  const trimmed = color.trim()
  const hsl = HSL_RE.exec(trimmed)
  if (hsl) {
    return hslToRgb(Number(hsl[1]), Number(hsl[2]), Number(hsl[3]))
  }

  const rgb = RGB_RE.exec(trimmed)
  if (rgb) {
    return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255]
  }

  let h = color.replace(/^#/, '')
  if (h.length === 3) {
    const r = h[0] ?? '0'
    const g = h[1] ?? '0'
    const b = h[2] ?? '0'
    h = r + r + g + g + b + b
  }
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  // A malformed hex yields NaN here; fall back to mid-grey instead of letting
  // NaN flow into the luminance math (which silently produced #ffffff for any
  // unparseable colour).
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return [0.5, 0.5, 0.5]
  return [r / 255, g / 255, b / 255]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sNorm = s / 100
  const lNorm = l / 100
  const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm
  const hh = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hh % 2) - 1))
  let r = 0
  let g = 0
  let b = 0
  if (hh < 1) { r = c; g = x }
  else if (hh < 2) { r = x; g = c }
  else if (hh < 3) { g = c; b = x }
  else if (hh < 4) { g = x; b = c }
  else if (hh < 5) { r = x; b = c }
  else { r = c; b = x }
  const m = lNorm - c / 2
  return [r + m, g + m, b + m]
}
