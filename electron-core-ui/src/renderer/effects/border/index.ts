export { BorderBeam, pickRandomBorderBeamProps } from './borderBeam'
export type { BorderBeamProps } from './borderBeam'

export { ShineBorder, pickRandomShineBorderProps } from './shineBorder'
export type { ShineBorderProps } from './shineBorder'

export { MagicCard, pickRandomMagicCardProps } from './magicCard'
export type { MagicCardProps } from './magicCard'

export { ElectricBorder, pickRandomElectricBorderProps } from './electricBorder'
export type { ElectricBorderProps } from './electricBorder'

export type BorderEffectId = 'border-beam' | 'shine-border' | 'magic-card' | 'electric-border'

export const borderEffectIds: readonly BorderEffectId[] = [
  'border-beam',
  'shine-border',
  'magic-card',
  'electric-border'
]

export function pickRandomBorderEffect(): BorderEffectId {
  const idx = Math.floor(Math.random() * borderEffectIds.length)
  return borderEffectIds[idx] ?? 'border-beam'
}
