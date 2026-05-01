export type VignetteDecorationId = 'border-beam' | 'shine-border' | 'magic-card'

export const vignetteDecorationIds: readonly VignetteDecorationId[] = [
  'border-beam',
  'shine-border',
  'magic-card'
]

export function pickRandomVignetteDecoration(): VignetteDecorationId {
  const idx = Math.floor(Math.random() * vignetteDecorationIds.length)
  return vignetteDecorationIds[idx] ?? 'border-beam'
}

export { BorderBeam } from './BorderBeam'
export type { BorderBeamProps } from './BorderBeam'
export { ShineBorder } from './ShineBorder'
export type { ShineBorderProps } from './ShineBorder'
export { MagicCard } from './MagicCard'
export type { MagicCardProps } from './MagicCard'
export {
  pickRandomBorderBeamProps,
  pickRandomShineBorderProps,
  pickRandomMagicCardProps
} from './random'
