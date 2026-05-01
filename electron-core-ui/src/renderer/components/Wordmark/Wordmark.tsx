import React, { useEffect, useState } from 'react'
import {
  DiaTextReveal,
  HyperText,
  Text3DFlip,
  TextAnimate,
  pickRandomDiaTextRevealProps,
  pickRandomHyperTextProps,
  pickRandomText3DFlipProps,
  pickRandomTextAnimateProps,
  pickRandomWordmarkEffect,
  type WordmarkEffectId
} from './effects'
import './wordmark.css'

export type WordmarkEffect = WordmarkEffectId | 'random'

type Phase = 'enter' | 'display' | 'exit'

interface CycleTimings {
  enter: number
  display: number
  exit: number
}

const TIMINGS: Record<WordmarkEffectId, CycleTimings> = {
  'text-animate': { enter: 1800, display: 41800, exit: 1400 },
  'dia-text-reveal': { enter: 2200, display: 42100, exit: 700 },
  'hyper-text': { enter: 1500, display: 42800, exit: 700 },
  'text-3d-flip': { enter: 1400, display: 42500, exit: 1100 }
}

export interface WordmarkProps {
  /** The text to render as the wordmark. */
  children: string
  /** Built-in effect applied to the text. Pass `'random'` to pick at mount
   *  (or per-iteration when `loop` is on). */
  effect?: WordmarkEffect
  /** When true, the wordmark cycles enter → display → exit → enter forever.
   *  A new random variant is picked at every iteration. */
  loop?: boolean
  /**
   * Optional delay in milliseconds before the first effect plays. The
   * wordmark renders empty during the delay so the surrounding layout
   * stays stable; when the timer fires, the regular enter animation
   * starts. Subsequent loop cycles aren't affected. Default: `0`.
   */
  startDelay?: number
  /** Optional className appended to the root for custom styling. */
  className?: string
  /** Optional inline style overrides on the root. */
  style?: React.CSSProperties
  /** Optional test id for stable E2E selectors. */
  'data-testid'?: string
}

export const Wordmark: React.FC<WordmarkProps> = ({
  children,
  effect,
  loop = false,
  startDelay = 0,
  className,
  style,
  'data-testid': dataTestId
}) => {
  const [iteration, setIteration] = useState(0)
  const [phase, setPhase] = useState<Phase>('enter')
  // Holds back rendering until `startDelay` ms have elapsed. When the
  // timer fires the wordmark mounts its effect normally; subsequent
  // loop cycles aren't gated on this.
  const [armed, setArmed] = useState(startDelay <= 0)
  useEffect(() => {
    if (armed) return undefined
    const t = window.setTimeout(() => { setArmed(true) }, startDelay)
    return () => { window.clearTimeout(t) }
  }, [armed, startDelay])

  // The rendered effect carries random per-iteration props — keep it in
  // useState (lazy init) and re-roll during render whenever effect / children
  // / iteration change. Avoids stuffing Math.random into useMemo.
  const [renderedEffect, setRenderedEffect] = useState<{
    id: WordmarkEffectId
    element: React.ReactElement
  } | null>(() => buildRendered(effect, children))
  const [lastSeed, setLastSeed] = useState({ effect, children, iteration })
  if (
    lastSeed.effect !== effect ||
    lastSeed.children !== children ||
    lastSeed.iteration !== iteration
  ) {
    setLastSeed({ effect, children, iteration })
    setRenderedEffect(buildRendered(effect, children))
  }

  // Loop state machine: enter → display → exit → next iteration. Each
  // iteration re-rolls the random effect/variant so consecutive cycles look
  // different. The optional whole-text flip phase has been retired in favor
  // of letter-by-letter flips via the `text-3d-flip` effect itself.
  useEffect(() => {
    if (!loop || !renderedEffect) return undefined
    const timings = TIMINGS[renderedEffect.id]

    if (phase === 'enter') {
      const t = window.setTimeout(() => { setPhase('display') }, timings.enter)
      return () => { window.clearTimeout(t) }
    }
    if (phase === 'display') {
      const t = window.setTimeout(() => { setPhase('exit') }, timings.display)
      return () => { window.clearTimeout(t) }
    }
    // phase === 'exit'
    const t = window.setTimeout(() => {
      setIteration((i) => i + 1)
      setPhase('enter')
    }, timings.exit)
    return () => { window.clearTimeout(t) }
  }, [loop, phase, iteration, renderedEffect])

  const classes = ['ecu-wordmark', className].filter(Boolean).join(' ')
  const dataAttrs: Record<string, string> = {}
  if (renderedEffect) dataAttrs['data-effect'] = renderedEffect.id
  if (loop) dataAttrs['data-phase'] = phase
  if (!armed) dataAttrs['data-armed'] = 'false'

  return (
    <span className={classes} style={style} data-testid={dataTestId} {...dataAttrs}>
      {armed ? (
        <span key={iteration} className="ecu-wordmark-iteration">
          {renderedEffect?.element ?? children}
        </span>
      ) : (
        // Reserve the wordmark's intrinsic layout box during
        // `startDelay` so adjacent rules / siblings don't shift
        // position when the text fades in. `visibility: hidden`
        // keeps the box without painting any glyphs.
        <span className="ecu-wordmark-iteration" style={{ visibility: 'hidden' }} aria-hidden="true">
          {children}
        </span>
      )}
    </span>
  )
}

const EFFECT_BUILDERS: Record<WordmarkEffectId, (text: string) => React.ReactElement> = {
  'text-animate': (text) => <TextAnimate text={text} {...pickRandomTextAnimateProps()} />,
  'dia-text-reveal': (text) => <DiaTextReveal text={text} {...pickRandomDiaTextRevealProps()} />,
  'hyper-text': (text) => <HyperText text={text} {...pickRandomHyperTextProps()} />,
  'text-3d-flip': (text) => <Text3DFlip text={text} {...pickRandomText3DFlipProps()} />
}

function buildEffectElement(id: WordmarkEffectId, text: string): React.ReactElement {
  return EFFECT_BUILDERS[id](text)
}

function buildRendered(
  effect: WordmarkEffect | undefined,
  text: string
): { id: WordmarkEffectId; element: React.ReactElement } | null {
  if (!effect) return null
  const id: WordmarkEffectId =
    effect === 'random' ? pickRandomWordmarkEffect() : effect
  return { id, element: buildEffectElement(id, text) }
}

export default Wordmark
