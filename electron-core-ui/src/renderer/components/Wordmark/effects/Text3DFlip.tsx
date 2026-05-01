import React, { useMemo, useState } from 'react'

// Adapted from Magic UI (MIT) — https://magicui.design/docs/components/text-3d-flip
// CSS-only port: each character animates rotateX/rotateY with a staggered
// delay. Spaces are kept as plain text so they preserve their natural width.

export type Text3DFlipDirection = 'top' | 'right' | 'bottom' | 'left'
export type Text3DFlipStaggerFrom = 'first' | 'last' | 'center' | 'random'

export interface Text3DFlipProps {
  /** Text to animate. */
  text: string
  /** Axis the characters flip toward. */
  direction?: Text3DFlipDirection
  /** Where the stagger originates from across the word. */
  staggerFrom?: Text3DFlipStaggerFrom
  /** Delay between consecutive characters, in milliseconds. */
  staggerDuration?: number
  /** Per-character animation duration, in milliseconds. */
  charDuration?: number
}

const HAS_SEGMENTER = typeof Intl !== 'undefined' && 'Segmenter' in Intl

function splitChars(text: string): string[] {
  if (HAS_SEGMENTER) {
    const seg = new Intl.Segmenter('en', { granularity: 'grapheme' })
    return Array.from(seg.segment(text), (s) => s.segment)
  }
  return Array.from(text)
}

function delayFor(
  index: number,
  total: number,
  from: Text3DFlipStaggerFrom,
  stagger: number,
  randomTarget: number
): number {
  if (from === 'first') return index * stagger
  if (from === 'last') return (total - 1 - index) * stagger
  if (from === 'center') {
    const center = Math.floor(total / 2)
    return Math.abs(center - index) * stagger
  }
  // 'random' — every char measures from the same random target.
  return Math.abs(randomTarget - index) * stagger
}

export const Text3DFlip: React.FC<Text3DFlipProps> = ({
  text,
  direction = 'right',
  staggerFrom = 'first',
  staggerDuration = 50,
  charDuration = 600
}) => {
  const chars = useMemo(() => splitChars(text), [text])
  // Picked once at mount via lazy state — Math.random() must not run inside
  // useMemo (impure on re-render). Subsequent prop changes don't reroll.
  const [randomTarget] = useState(() =>
    staggerFrom === 'random' ? Math.floor(Math.random() * Math.max(1, chars.length)) : 0
  )

  return (
    <span
      className="ecu-wordmark-effect-text-3d-flip"
      data-direction={direction}
      aria-label={text}
    >
      {chars.map((char, index) => {
        if (char === ' ') {
          return (
            <span key={index} className="ecu-wordmark-effect-text-3d-flip-space" aria-hidden="true">
              {char}
            </span>
          )
        }
        const delay = delayFor(index, chars.length, staggerFrom, staggerDuration, randomTarget)
        return (
          <span
            key={index}
            className="ecu-wordmark-effect-text-3d-flip-char"
            style={{
              animationDelay: `${delay}ms`,
              animationDuration: `${charDuration}ms`
            }}
            aria-hidden="true"
          >
            <span className="ecu-wordmark-effect-text-3d-flip-face ecu-wordmark-effect-text-3d-flip-face-front">
              {char}
            </span>
            <span className="ecu-wordmark-effect-text-3d-flip-face ecu-wordmark-effect-text-3d-flip-face-back">
              {char}
            </span>
          </span>
        )
      })}
    </span>
  )
}
