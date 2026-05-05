import React, { useEffect, useId, useRef } from 'react'
import './electricBorder.css'

// Adapted from Bálint Ferenczy's "Animated Electric Border CSS Card"
// (https://codepen.io/BalintFerenczy/pen/KwdoyEN, MIT-style demo).
// Differences vs the original:
//   - Per-instance filter id (via React's `useId`) so several
//     ElectricBorders can coexist on the same page without their
//     `<feOffset>` animation states colliding.
//   - Color, border width, and animation duration are exposed as
//     props (mapped to CSS vars on the root + the JS animation loop).
//   - The original drove the offsets via SMIL `<animate>` elements.
//     Chromium has a multi-second startup latency on first SMIL use
//     in a freshly-mounted filter, which made the wobble look frozen
//     for the bubble's first few seconds. We replace SMIL with a
//     `requestAnimationFrame` loop that writes `dx` / `dy` directly
//     on the four `<feOffset>` elements — true sine, deterministic,
//     no warm-up.
//   - Drops the original card's content / typography concerns: this
//     is an overlay effect, not a card layout.

export interface ElectricBorderProps {
  /** Base color of the wobbling border. Drives the glow + halo via OKLCH. */
  color?: string
  /** Border-ring width in pixels. */
  borderWidth?: number
  /** Duration of one full noise cycle, in seconds. */
  duration?: number
  /** Border radius for the effect; defaults to `inherit` from the parent. */
  borderRadius?: string
}

/**
 * Pairwise duration multipliers — irregular by design so the four
 * `<feOffset>` periods stay incommensurate. With a single shared
 * duration the four pairs would re-lock every cycle and their
 * dy/dx contributions would cancel each other's velocity at the
 * re-locks (visible "plateau" moments). Drift forever instead.
 */
const PAIR_DURATION_MULTIPLIERS = [1.0, 1.317, 0.819, 1.143] as const

/**
 * Pairwise phase offsets (fraction of the per-pair period) that
 * scatter the four offsets around the unit circle at t=0. Avoids
 * the four pairs all sitting at their `from` value simultaneously
 * on first paint, which would make the displacement field static
 * for ~half a cycle until the layers diverge.
 */
const PAIR_PHASE_OFFSETS = [0.0, 0.125, 0.5, 0.625] as const

/** dy amplitude in pixels for the first two `<feOffset>` pairs. */
const DY_AMPLITUDE = 350

/** dx amplitude in pixels for the last two `<feOffset>` pairs. */
const DX_AMPLITUDE = 245

export const ElectricBorder: React.FC<ElectricBorderProps> = ({
  color = '#dd8448',
  borderWidth = 2,
  duration = 6,
  borderRadius
}) => {
  // `useId` returns a stable, server-/client-coherent id; suffixing it
  // narrows it down to one filter so we can refer to it from `filter:
  // url(#...)` without colliding with another ElectricBorder on the page.
  const reactId = useId()
  const filterId = `ecu-electric-border-displace-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`

  const offsetRefs = useRef<(SVGFEOffsetElement | null)[]>([null, null, null, null])

  useEffect(() => {
    let rafId = 0
    const start = performance.now()
    // Capture the offsets array at effect-setup time. The cleanup runs
    // synchronously when the component unmounts, so the ref's `current`
    // is still pointing at the same elements; we just want to avoid the
    // (very small) risk of React 19's strict-mode double-invocation
    // re-binding the array between scheduling and cleanup.
    const offsets = offsetRefs.current

    const tick = (): void => {
      const t = (performance.now() - start) / 1000

      for (let i = 0; i < 4; i += 1) {
        const offsetEl = offsets[i]
        if (offsetEl === null || offsetEl === undefined) continue
        const durMultiplier = PAIR_DURATION_MULTIPLIERS[i] ?? 1
        const phaseOffset = PAIR_PHASE_OFFSETS[i] ?? 0
        const dur = duration * durMultiplier
        const phase = ((t / dur) + phaseOffset) % 1
        const angle = phase * 2 * Math.PI
        // Pairs 0/1 animate dy, pairs 2/3 animate dx. Pair 0 swings
        // positive-first, pair 1 negative-first (so they fight each
        // other across the y-axis); same for pairs 2/3 on the x-axis.
        if (i === 0) {
          offsetEl.setAttribute('dy', String(DY_AMPLITUDE * Math.sin(angle)))
          offsetEl.setAttribute('dx', '0')
        } else if (i === 1) {
          offsetEl.setAttribute('dy', String(-DY_AMPLITUDE * Math.sin(angle)))
          offsetEl.setAttribute('dx', '0')
        } else if (i === 2) {
          offsetEl.setAttribute('dx', String(DX_AMPLITUDE * Math.sin(angle)))
          offsetEl.setAttribute('dy', '0')
        } else {
          offsetEl.setAttribute('dx', String(-DX_AMPLITUDE * Math.sin(angle)))
          offsetEl.setAttribute('dy', '0')
        }
      }

      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)

    return (): void => {
      cancelAnimationFrame(rafId)
    }
  }, [duration])

  const rootStyle: React.CSSProperties = {
    ['--ecu-electric-border-color' as string]: color,
    ['--ecu-electric-border-width' as string]: `${borderWidth}px`,
    ...(borderRadius !== undefined ? { ['--ecu-electric-border-radius' as string]: borderRadius } : {})
  }

  return (
    <div className="ecu-border-effect ecu-electric-border" style={rootStyle} aria-hidden="true">
      <svg className="ecu-electric-border-filter-host">
        <defs>
          <filter
            id={filterId}
            colorInterpolationFilters="sRGB"
            x="-50%"
            y="-50%"
            width="200%"
            height="200%"
          >
            {/* Four turbulence/offset pairs composited together to
                produce the flowing "electric" wobble. The `dx` / `dy`
                of each `<feOffset>` is driven from JS via the
                `requestAnimationFrame` loop above — a true sine on
                each pair with irregular per-pair durations and
                staggered phase offsets so the displacement field
                stays chaotic from frame 1 with no SMIL warm-up. */}
            <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="10" result="noise1" seed="1" />
            <feOffset
              ref={(el) => { offsetRefs.current[0] = el }}
              in="noise1"
              dx="0"
              dy="0"
              result="offsetNoise1"
            />

            <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="10" result="noise2" seed="1" />
            <feOffset
              ref={(el) => { offsetRefs.current[1] = el }}
              in="noise2"
              dx="0"
              dy="0"
              result="offsetNoise2"
            />

            <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="10" result="noise3" seed="2" />
            <feOffset
              ref={(el) => { offsetRefs.current[2] = el }}
              in="noise3"
              dx="0"
              dy="0"
              result="offsetNoise3"
            />

            <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="10" result="noise4" seed="2" />
            <feOffset
              ref={(el) => { offsetRefs.current[3] = el }}
              in="noise4"
              dx="0"
              dy="0"
              result="offsetNoise4"
            />

            <feComposite in="offsetNoise1" in2="offsetNoise2" result="part1" />
            <feComposite in="offsetNoise3" in2="offsetNoise4" result="part2" />
            <feBlend in="part1" in2="part2" mode="color-dodge" result="combinedNoise" />

            <feDisplacementMap in="SourceGraphic" in2="combinedNoise" scale="30" xChannelSelector="R" yChannelSelector="B" />
          </filter>
        </defs>
      </svg>

      <div className="ecu-electric-border-halo" />
      <div className="ecu-electric-border-overlay ecu-electric-border-overlay--bright" />
      <div className="ecu-electric-border-overlay ecu-electric-border-overlay--dim" />
      <div className="ecu-electric-border-glow-soft" />
      <div className="ecu-electric-border-glow-bright" />
      <div
        className="ecu-electric-border-main"
        style={{ filter: `url(#${filterId})` }}
      />
    </div>
  )
}
