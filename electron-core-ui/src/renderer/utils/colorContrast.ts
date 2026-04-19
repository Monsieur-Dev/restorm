/**
 * Returns '#000000' (black) or '#ffffff' (white) depending on which
 * provides better contrast against the given background color.
 *
 * Accepts hex (`#rgb`, `#rrggbb`, or no leading `#`) and `hsl(h, s%, l%)`.
 * Uses the W3C relative luminance formula (WCAG 2.0).
 */
export function getContrastColor(color: string): '#000000' | '#ffffff' {
  const rgb = parseColorToRgb(color)
  const toLinear = (c: number): number =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)

  const luminance =
    0.2126 * toLinear(rgb[0]) + 0.7152 * toLinear(rgb[1]) + 0.0722 * toLinear(rgb[2])

  return luminance > 0.179 ? '#000000' : '#ffffff'
}

const HSL_RE = /^hsl\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)%\s*,\s*(\d+(?:\.\d+)?)%\s*\)$/i

function parseColorToRgb(color: string): [number, number, number] {
  const hsl = HSL_RE.exec(color.trim())
  if (hsl) {
    return hslToRgb(Number(hsl[1]), Number(hsl[2]), Number(hsl[3]))
  }

  let h = color.replace(/^#/, '')
  if (h.length === 3) {
    const r = h[0] ?? '0'
    const g = h[1] ?? '0'
    const b = h[2] ?? '0'
    h = r + r + g + g + b + b
  }
  const r = parseInt(h.substring(0, 2), 16) / 255
  const g = parseInt(h.substring(2, 4), 16) / 255
  const b = parseInt(h.substring(4, 6), 16) / 255
  return [r, g, b]
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
