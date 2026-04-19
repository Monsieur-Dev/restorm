/**
 * Deterministic color from a string. Same input → same output across sessions
 * and machines. Uses FNV-1a to derive a hue in [0, 360) and returns an HSL
 * string with fixed saturation and lightness tuned so that getContrastColor()
 * always returns a readable black/white overlay.
 */
const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193
const SATURATION_PERCENT = 65
const LIGHTNESS_PERCENT = 50

function fnv1aHash(input: string): number {
  let hash = FNV_OFFSET_BASIS
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, FNV_PRIME)
  }
  return hash >>> 0
}

export function getColorFromString(input: string): string {
  const hue = fnv1aHash(input) % 360
  return `hsl(${hue}, ${SATURATION_PERCENT}%, ${LIGHTNESS_PERCENT}%)`
}
