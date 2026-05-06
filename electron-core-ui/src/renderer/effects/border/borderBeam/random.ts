import type { BorderBeamProps } from './BorderBeam'

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
 * Returns a coherent set of randomized props for the Border Beam effect.
 * Trail size, lap duration and starting offset are randomized; colors land on
 * a vibrant gradient pair. Direction flips evenly.
 */
export function pickRandomBorderBeamProps(): BorderBeamProps {
  const { colorFrom, colorTo } = pickBeamColors()
  return {
    colorFrom,
    colorTo,
    size: randInt(40, 90),
    duration: randFloat(5, 11),
    initialOffset: randInt(0, 100),
    borderWidth: Math.random() < 0.75 ? 1 : 2,
    reverse: Math.random() < 0.5
  }
}
