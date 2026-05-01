import React, { useEffect, useState } from 'react'

// Adapted from Magic UI (MIT) — https://magicui.design/docs/components/hyper-text
// rAF + React state replaces motion's animation timing.

type CharacterSet = readonly string[]

const DEFAULT_CHARACTER_SET: CharacterSet = Object.freeze(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
)

const pickRandomChar = (charset: CharacterSet): string => {
  if (charset.length === 0) return ''
  return charset[Math.floor(Math.random() * charset.length)] ?? ''
}

export interface HyperTextProps {
  /** Text to scramble. */
  text: string
  /** Duration of the scramble in milliseconds. */
  duration?: number
  /** Pool of characters used while a position hasn't settled yet. */
  characterSet?: CharacterSet
}

export const HyperText: React.FC<HyperTextProps> = ({
  text,
  duration = 800,
  characterSet = DEFAULT_CHARACTER_SET
}) => {
  const [displayText, setDisplayText] = useState<string[]>(() => text.split(''))

  useEffect(() => {
    let raf = 0
    const start = performance.now()
    const max = text.length
    const target = text.split('')

    const tick = (now: number): void => {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      const settled = progress * max

      setDisplayText(
        target.map((c, i) => {
          if (c === ' ') return c
          if (i <= settled) return c
          return pickRandomChar(characterSet)
        })
      )

      if (progress < 1) {
        raf = requestAnimationFrame(tick)
      }
    }

    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf) }
  }, [text, duration, characterSet])

  return (
    <span className="ecu-wordmark-effect-hyper-text" aria-label={text}>
      {displayText.map((letter, idx) => (
        <span
          key={idx}
          className="ecu-wordmark-effect-hyper-text-char"
          aria-hidden="true"
        >
          {letter}
        </span>
      ))}
    </span>
  )
}
