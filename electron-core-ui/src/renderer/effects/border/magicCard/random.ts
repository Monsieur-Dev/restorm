import type { MagicCardProps } from './MagicCard'

function randInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1))
}

function randFloat(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

/**
 * Picks a vibrant gradient pair: two saturated hues 50-130° apart in HSL,
 * matching the visual energy of magicui's default orange→purple beam.
 */
function pickBeamColors(): { colorFrom: string; colorTo: string } {
  const baseHue = Math.floor(Math.random() * 360)
  const offset = randInt(50, 130) * (Math.random() < 0.5 ? -1 : 1)
  const saturation = randInt(70, 90)
  const lightness = randInt(55, 65)
  const colorFrom = `hsl(${baseHue}, ${saturation}%, ${lightness}%)`
  const colorTo = `hsl(${(baseHue + offset + 360) % 360}, ${saturation}%, ${lightness}%)`
  return { colorFrom, colorTo }
}

/**
 * Returns a coherent set of randomized props for the Magic Card effect.
 * Spotlight size, blur radius and the two-stop gradient are randomized while
 * keeping the vibrant pair feel of the magicui defaults.
 */
export function pickRandomMagicCardProps(): MagicCardProps {
  const { colorFrom, colorTo } = pickBeamColors()
  return {
    gradientFrom: colorFrom,
    gradientTo: colorTo,
    gradientSize: randInt(220, 360),
    blur: randInt(20, 48),
    maxOpacity: randFloat(0.3, 0.5)
  }
}
