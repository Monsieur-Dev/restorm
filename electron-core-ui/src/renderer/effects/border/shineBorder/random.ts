import type { ShineBorderProps } from './ShineBorder'

function randInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1))
}

function randFloat(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

/**
 * Returns a coherent set of randomized props for the Shine Border effect.
 * Picks a 2-3 color vibrant gradient sweeping around the border at a slow,
 * cinematic pace.
 */
export function pickRandomShineBorderProps(): ShineBorderProps {
  const baseHue = Math.floor(Math.random() * 360)
  const colorCount = randInt(2, 3)
  const saturation = randInt(75, 90)
  const lightness = randInt(55, 65)
  const colors: string[] = []
  for (let i = 0; i < colorCount; i++) {
    const hue = (baseHue + i * randInt(40, 110)) % 360
    colors.push(`hsl(${hue}, ${saturation}%, ${lightness}%)`)
  }
  return {
    shineColor: colors,
    borderWidth: Math.random() < 0.7 ? 1 : 2,
    duration: randFloat(8, 18)
  }
}
