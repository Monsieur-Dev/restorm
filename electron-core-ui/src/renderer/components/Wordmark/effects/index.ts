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
export { DiaTextReveal } from './DiaTextReveal'
export { HyperText } from './HyperText'
export { Text3DFlip } from './Text3DFlip'
export {
  pickRandomTextAnimateProps,
  pickRandomDiaTextRevealProps,
  pickRandomHyperTextProps,
  pickRandomText3DFlipProps
} from './random'
