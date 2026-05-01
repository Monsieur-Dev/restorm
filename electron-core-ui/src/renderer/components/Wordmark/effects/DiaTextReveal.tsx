import React, { useEffect, useRef } from 'react'

// Adapted from Magic UI (MIT) — https://magicui.design/docs/components/dia-text-reveal
// rAF loop replaces motion's animate() so the sweep runs without a runtime dep.

const DEFAULT_COLORS = ['#c679c4', '#fa3d1d', '#ffb005', '#e1e1fe', '#0358f7']
const BAND_HALF = 17
const SWEEP_START = -BAND_HALF
const SWEEP_END = 100 + BAND_HALF

const sweepEase = (t: number): number =>
  t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2

function buildGradient(pos: number, colors: readonly string[], textColor: string): string {
  const bandStart = pos - BAND_HALF
  const bandEnd = pos + BAND_HALF

  if (bandStart >= 100) {
    return `linear-gradient(90deg, ${textColor}, ${textColor})`
  }
  const n = colors.length
  const parts: string[] = []

  if (bandStart > 0) {
    parts.push(`${textColor} 0%`, `${textColor} ${bandStart.toFixed(2)}%`)
  }

  colors.forEach((c, i) => {
    const pct = n === 1 ? pos : bandStart + (i / (n - 1)) * BAND_HALF * 2
    parts.push(`${c} ${pct.toFixed(2)}%`)
  })

  if (bandEnd < 100) {
    parts.push(`transparent ${bandEnd.toFixed(2)}%`, `transparent 100%`)
  }

  return `linear-gradient(90deg, ${parts.join(', ')})`
}

export interface DiaTextRevealProps {
  /** Text to reveal. */
  text: string
  /** Colors sampled across the moving gradient band. */
  colors?: readonly string[]
  /** Color of the settled text once the band has passed. */
  textColor?: string
  /** Duration of one sweep, in seconds. */
  duration?: number
  /** Delay before the sweep starts, in seconds. */
  delay?: number
}

export const DiaTextReveal: React.FC<DiaTextRevealProps> = ({
  text,
  colors = DEFAULT_COLORS,
  textColor = 'var(--foreground)',
  duration = 1.5,
  delay = 0
}) => {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined

    let raf = 0
    let startTs = 0
    const totalMs = duration * 1000
    const delayMs = delay * 1000

    const apply = (pos: number): void => {
      el.style.backgroundImage = buildGradient(pos, colors, textColor)
    }
    apply(SWEEP_START)

    const tick = (ts: number): void => {
      if (startTs === 0) startTs = ts
      const elapsed = ts - startTs - delayMs
      if (elapsed < 0) {
        raf = requestAnimationFrame(tick)
        return
      }
      const rawT = Math.min(elapsed / totalMs, 1)
      const eased = sweepEase(rawT)
      const pos = SWEEP_START + (SWEEP_END - SWEEP_START) * eased
      apply(pos)
      if (rawT < 1) {
        raf = requestAnimationFrame(tick)
      }
    }
    raf = requestAnimationFrame(tick)

    return () => { cancelAnimationFrame(raf) }
  }, [colors, textColor, duration, delay])

  return (
    <span
      ref={ref}
      className="ecu-wordmark-effect-dia-text-reveal"
      style={{
        color: 'transparent',
        backgroundClip: 'text',
        WebkitBackgroundClip: 'text',
        backgroundSize: '100% 100%'
      }}
    >
      {text}
    </span>
  )
}
