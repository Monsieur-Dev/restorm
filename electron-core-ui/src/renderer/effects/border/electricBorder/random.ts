import type { ElectricBorderProps } from './ElectricBorder'

function randInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1))
}

function randFloat(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

/**
 * Returns a coherent set of randomized props for the Electric Border effect.
 * Picks one of a curated palette of vibrant electric-y hues (cyan, magenta,
 * yellow, lime, the original orange) so the OKLCH-derived light + gradient
 * stay readable on a dark background, randomizes the noise-cycle duration
 * (5-9 s) and the border width (2 or 3 px).
 */
export function pickRandomElectricBorderProps(): ElectricBorderProps {
  const palette = [
    '#dd8448', // codepen original (orange)
    '#f9d75c', // amber yellow
    '#5cf9d6', // electric cyan
    '#a3f95c', // electric lime
    '#f95cd6', // hot magenta
    '#5c8cf9', // electric blue
    '#f95c5c'  // electric red
  ]
  const color = palette[randInt(0, palette.length - 1)] ?? '#dd8448'
  return {
    color,
    borderWidth: Math.random() < 0.7 ? 2 : 3,
    duration: randFloat(5, 9)
  }
}
