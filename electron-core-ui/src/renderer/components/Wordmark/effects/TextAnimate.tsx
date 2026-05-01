import React from 'react'

// Adapted from Magic UI (MIT) — https://magicui.design/docs/components/text-animate
// Animations reimplemented as CSS keyframes (no motion dep).

export type TextAnimateBy = 'word' | 'character'
export type TextAnimateVariant =
  | 'fade-in'
  | 'blur-in'
  | 'blur-in-up'
  | 'blur-in-down'
  | 'slide-up'
  | 'slide-down'
  | 'slide-left'
  | 'slide-right'
  | 'scale-up'
  | 'scale-down'

export interface TextAnimateProps {
  /** Text to animate. */
  text: string
  /** How to split the text for the stagger effect. */
  by?: TextAnimateBy
  /** Visual animation variant for each segment. */
  variant?: TextAnimateVariant
  /** Delay between consecutive segments, in milliseconds. */
  stagger?: number
  /** Per-segment animation duration, in milliseconds. */
  duration?: number
}

function splitText(text: string, by: TextAnimateBy): string[] {
  if (by === 'character') return Array.from(text)
  return text.split(/(\s+)/)
}

export const TextAnimate: React.FC<TextAnimateProps> = ({
  text,
  by = 'word',
  variant = 'blur-in-up',
  stagger = 60,
  duration = 600
}) => {
  const segments = splitText(text, by)

  return (
    <span
      className="ecu-wordmark-effect-text-animate"
      data-by={by}
      data-variant={variant}
      aria-label={text}
    >
      {segments.map((segment, index) => {
        if (segment.trim() === '' && by === 'word') {
          return (
            <span key={`${index}-${segment}`} aria-hidden="true">
              {segment}
            </span>
          )
        }
        return (
          <span
            key={`${index}-${segment}`}
            className="ecu-wordmark-effect-text-animate-segment"
            style={{
              animationDelay: `${index * stagger}ms`,
              animationDuration: `${duration}ms`
            }}
            aria-hidden="true"
          >
            {segment}
          </span>
        )
      })}
    </span>
  )
}
