/**
 * Returns '#000000' (black) or '#ffffff' (white) depending on which
 * provides better contrast against the given background color.
 *
 * Uses the W3C relative luminance formula (WCAG 2.0).
 */
export function getContrastColor(hex: string): '#000000' | '#ffffff' {
  let h = hex.replace(/^#/, '')
  if (h.length === 3) {
    const r = h[0] ?? '0'
    const g = h[1] ?? '0'
    const b = h[2] ?? '0'
    h = r + r + g + g + b + b
  }

  const r = parseInt(h.substring(0, 2), 16) / 255
  const g = parseInt(h.substring(2, 4), 16) / 255
  const b = parseInt(h.substring(4, 6), 16) / 255

  const toLinear = (c: number): number =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)

  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)

  return luminance > 0.179 ? '#000000' : '#ffffff'
}
