import type { DiaTextRevealProps } from './DiaTextReveal'
import type { HyperTextProps } from './HyperText'
import type {
  Text3DFlipDirection,
  Text3DFlipProps,
  Text3DFlipStaggerFrom
} from './Text3DFlip'
import type {
  TextAnimateBy,
  TextAnimateProps,
  TextAnimateVariant
} from './TextAnimate'

const TEXT_3D_FLIP_DIRECTIONS: Text3DFlipDirection[] = ['top', 'right', 'bottom', 'left']
const TEXT_3D_FLIP_STAGGER_FROMS: Text3DFlipStaggerFrom[] = ['first', 'last', 'center', 'random']

const HYPER_TEXT_CHARSETS: readonly (readonly string[])[] = [
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
  'abcdefghijklmnopqrstuvwxyz'.split(''),
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.split(''),
  '0123456789ABCDEF'.split(''),
  '!@#$%&*+=<>?/\\|~'.split(''),
  'αβγδεζηθικλμνξοπρστυφχψω'.split('')
]

const TEXT_ANIMATE_VARIANTS: TextAnimateVariant[] = [
  'fade-in',
  'blur-in',
  'blur-in-up',
  'blur-in-down',
  'slide-up',
  'slide-down',
  'slide-left',
  'slide-right',
  'scale-up',
  'scale-down'
]

function randInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1))
}

function randFloat(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function pickFrom<T>(values: readonly T[], fallback: T): T {
  if (values.length === 0) return fallback
  return values[Math.floor(Math.random() * values.length)] ?? fallback
}

/**
 * Returns a coherent set of randomized props for the Text 3D Flip effect.
 * Picks a flip axis, a stagger origin, and per-character timing.
 */
export function pickRandomText3DFlipProps(): Omit<Text3DFlipProps, 'text'> {
  const direction =
    TEXT_3D_FLIP_DIRECTIONS[Math.floor(Math.random() * TEXT_3D_FLIP_DIRECTIONS.length)] ??
    'right'
  const staggerFrom =
    TEXT_3D_FLIP_STAGGER_FROMS[Math.floor(Math.random() * TEXT_3D_FLIP_STAGGER_FROMS.length)] ??
    'first'
  return {
    direction,
    staggerFrom,
    staggerDuration: randInt(35, 80),
    charDuration: randInt(450, 700)
  }
}

/**
 * Returns a coherent set of randomized props for the Hyper Text scramble.
 * Picks a random charset (alpha, alphanumeric, hex, symbols, greek, ...) and
 * a comfortable scramble duration.
 */
export function pickRandomHyperTextProps(): Omit<HyperTextProps, 'text'> {
  const idx = Math.floor(Math.random() * HYPER_TEXT_CHARSETS.length)
  const characterSet = HYPER_TEXT_CHARSETS[idx] ?? HYPER_TEXT_CHARSETS[0] ?? []
  return {
    duration: randInt(700, 1400),
    characterSet
  }
}

/**
 * Returns a coherent set of randomized props for the Dia Text Reveal effect.
 * Picks a vibrant 3-5 color gradient palette and a sweep duration tuned to
 * feel snappy without missing the band.
 */
export function pickRandomDiaTextRevealProps(): Omit<DiaTextRevealProps, 'text'> {
  const colorCount = randInt(3, 5)
  const baseHue = Math.floor(Math.random() * 360)
  const saturation = randInt(75, 90)
  const lightness = randInt(50, 60)
  const colors = Array.from({ length: colorCount }, (_, i) => {
    const hue = (baseHue + i * randInt(50, 90)) % 360
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`
  })
  return {
    colors,
    duration: randFloat(1.1, 1.9)
  }
}

/**
 * Returns a coherent set of randomized props for the Text Animate effect.
 * Picks a split mode, a visual variant, a stagger pace and a per-segment
 * duration. Stagger is tuned to the split mode so words feel snappier and
 * characters can crawl a touch slower.
 */
export function pickRandomTextAnimateProps(): Omit<TextAnimateProps, 'text'> {
  const by: TextAnimateBy = Math.random() < 0.55 ? 'word' : 'character'
  const variant = pickFrom(TEXT_ANIMATE_VARIANTS, 'blur-in-up')
  const stagger = by === 'word' ? randInt(60, 140) : randInt(28, 70)
  const duration = randInt(450, 850)
  return { by, variant, stagger, duration }
}
