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

/**
 * Pick a random border effect id. Pass `options.exclude` to remove
 * specific ids from the pool (e.g. `{ exclude: ['electric-border'] }`
 * to keep the high-impact electric-border effect for explicit
 * "big-occasion" usage rather than letting it land on every routine
 * `decoration="random"` call). Throws if `exclude` empties the pool.
 */
export function pickRandomBorderEffect(options?: {
  exclude?: readonly BorderEffectId[]
}): BorderEffectId {
  const excluded = new Set<BorderEffectId>(options?.exclude ?? [])
  const candidates = borderEffectIds.filter((id) => !excluded.has(id))
  if (candidates.length === 0) {
    throw new Error('pickRandomBorderEffect: cannot pick — every effect id was excluded')
  }
  const idx = Math.floor(Math.random() * candidates.length)
  // The `?? candidates[0] ?? 'border-beam'` chain looks redundant
  // (the length check above already guarantees at least one
  // candidate), but it short-circuits TypeScript's strict
  // index-might-be-undefined complaint without a non-null assertion.
  return candidates[idx] ?? candidates[0] ?? 'border-beam'
}
