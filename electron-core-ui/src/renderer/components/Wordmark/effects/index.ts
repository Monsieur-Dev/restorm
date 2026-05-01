export type WordmarkEffectId =
  | 'text-animate'
  | 'dia-text-reveal'
  | 'hyper-text'
  | 'text-3d-flip'

export const wordmarkEffectIds: readonly WordmarkEffectId[] = [
  'text-animate',
  'dia-text-reveal',
  'hyper-text',
  'text-3d-flip'
]

export function pickRandomWordmarkEffect(): WordmarkEffectId {
  const idx = Math.floor(Math.random() * wordmarkEffectIds.length)
  return wordmarkEffectIds[idx] ?? 'text-animate'
}

export { TextAnimate } from './TextAnimate'
export type {
  TextAnimateProps,
  TextAnimateBy,
  TextAnimateVariant
} from './TextAnimate'
export { DiaTextReveal } from './DiaTextReveal'
export type { DiaTextRevealProps } from './DiaTextReveal'
export { HyperText } from './HyperText'
export type { HyperTextProps } from './HyperText'
export { Text3DFlip } from './Text3DFlip'
export type {
  Text3DFlipProps,
  Text3DFlipDirection,
  Text3DFlipStaggerFrom
} from './Text3DFlip'
export {
  pickRandomTextAnimateProps,
  pickRandomDiaTextRevealProps,
  pickRandomHyperTextProps,
  pickRandomText3DFlipProps
} from './random'
