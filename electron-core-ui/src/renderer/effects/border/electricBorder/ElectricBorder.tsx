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
 * Eight `<feTurbulence>` + `<feOffset>` pairs — extra layers dilute
 * the "all contributions happen to cancel right now" moments that
 * produced the flat-line artifact when fewer pairs were running.
 *
 * Each offset traces an ellipse at *constant angular speed*
 * (`dx = rx·cos(angle)`, `dy = ry·sin(angle)`) — no slow-down at
 * extremes, no direction flip, no perceptible "respiration".
 *
 * Three deliberately-chaotic parameter sets:
 *
 * 1. **Duration multipliers** — eight irrational-feeling ratios
 *    spread across [0.5, 2.0] so the periods stay mutually
 *    incommensurate and never re-lock.
 * 2. **Phase offsets** — *not* evenly spaced (0, 1/8, 2/8, ...
 *    would produce a regular star pattern at t=0); we use random-
 *    looking values across [0, 1) so the eight ellipse positions
 *    are genuinely scattered around their own circles.
 * 3. **Radii** — different (rx, ry) per pair so the orbits trace
 *    different ellipse shapes and sample different parts of the
 *    underlying noise field.
 *
 * Per-pair direction alternates so the composite has no global
 * rotation drift.
 */
const PAIR_DURATION_MULTIPLIERS = [1.0, 1.317, 0.819, 1.143, 0.703, 1.481, 0.591, 1.879] as const
const PAIR_PHASE_OFFSETS = [0.0, 0.137, 0.421, 0.683, 0.812, 0.244, 0.567, 0.071] as const
const PAIR_RADII_X = [350, 245, 280, 300, 220, 320, 270, 240] as const
const PAIR_RADII_Y = [280, 350, 245, 220, 300, 260, 330, 290] as const
const PAIR_DIRECTIONS = [1, -1, 1, -1, 1, -1, 1, -1] as const
const PAIR_COUNT = 8

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

  const offsetRefs = useRef<(SVGFEOffsetElement | null)[]>(Array.from({ length: PAIR_COUNT }, () => null))

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

      for (let i = 0; i < PAIR_COUNT; i += 1) {
        const offsetEl = offsets[i]
        if (offsetEl === null || offsetEl === undefined) continue
        const durMultiplier = PAIR_DURATION_MULTIPLIERS[i] ?? 1
        const phaseOffset = PAIR_PHASE_OFFSETS[i] ?? 0
        const dur = duration * durMultiplier
        const phase = ((t / dur) + phaseOffset) % 1
        // Per-pair direction: clockwise vs counter-clockwise so the
        // composite displacement field doesn't drift in one direction.
        const direction = PAIR_DIRECTIONS[i] ?? 1
        const angle = phase * 2 * Math.PI * direction
        const rx = PAIR_RADII_X[i] ?? 100
        const ry = PAIR_RADII_Y[i] ?? 100
        // Centred ellipse, constant angular speed — no slow-down at
        // extremes. Six pairs (vs four) thin out the chance that all
        // contributions cancel simultaneously into a flat composite.
        offsetEl.setAttribute('dx', String(rx * Math.cos(angle)))
        offsetEl.setAttribute('dy', String(ry * Math.sin(angle)))
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
            {/* Eight turbulence/offset pairs composited into a single
                noise field. The `dx` / `dy` of each `<feOffset>` is
                driven from JS via the `requestAnimationFrame` loop
                above — every offset traces an ellipse at constant
                angular speed (no SMIL, no warm-up). Eight pairs (vs
                the codepen's four) keep the global magnitude of the
                composite displacement vector well above zero at all
                times: cancelling-to-zero requires an unlikely
                alignment of *eight* incommensurate phases, so the
                "flat-line" artifact that smaller pair counts
                produced is gone in practice. */}
            <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="10" result="noise1" seed="1" />
            <feOffset ref={(el) => { offsetRefs.current[0] = el }} in="noise1" dx="0" dy="0" result="offsetNoise1" />

            <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="10" result="noise2" seed="1" />
            <feOffset ref={(el) => { offsetRefs.current[1] = el }} in="noise2" dx="0" dy="0" result="offsetNoise2" />

            <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="10" result="noise3" seed="2" />
            <feOffset ref={(el) => { offsetRefs.current[2] = el }} in="noise3" dx="0" dy="0" result="offsetNoise3" />

            <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="10" result="noise4" seed="2" />
            <feOffset ref={(el) => { offsetRefs.current[3] = el }} in="noise4" dx="0" dy="0" result="offsetNoise4" />

            <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="10" result="noise5" seed="3" />
            <feOffset ref={(el) => { offsetRefs.current[4] = el }} in="noise5" dx="0" dy="0" result="offsetNoise5" />

            <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="10" result="noise6" seed="3" />
            <feOffset ref={(el) => { offsetRefs.current[5] = el }} in="noise6" dx="0" dy="0" result="offsetNoise6" />

            <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="10" result="noise7" seed="4" />
            <feOffset ref={(el) => { offsetRefs.current[6] = el }} in="noise7" dx="0" dy="0" result="offsetNoise7" />

            <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="10" result="noise8" seed="4" />
            <feOffset ref={(el) => { offsetRefs.current[7] = el }} in="noise8" dx="0" dy="0" result="offsetNoise8" />

            {/* Pair the offsets two-by-two then fold the four parts
                together with `feBlend mode="hard-light"` at every
                stage. Picking the blend mode here is non-obvious: a
                brute-force search (see `/tmp/electric-search.mjs`)
                evaluated minimum spatial std-dev over many frames
                across all SVG blend modes for both 8-pair and 4-pair
                chains. Anything that collapses the channels toward a
                uniform value at any frame produces the visible
                "flat-line" artifact (the displacement map degenerates
                into a uniform translation).
                Discarded options and why:
                  • `feComposite` (default `operator="over"`) silently
                    drops the second input when both are opaque (which
                    `feTurbulence` always is) → half the pairs never
                    reach the displacement map.
                  • `screen`, `color-dodge`, `multiply`, `color-burn`,
                    `exclusion` push both inputs toward 0 or 1 and
                    saturate after a few stages of chaining → the
                    composite collapses to a uniform translation.
                  • `overlay`, `soft-light`, `difference`, `lighten`,
                    `darken`, `normal` all dipped below the no-flat-
                    line threshold (min spatial std-dev > 0.05) at
                    8 pairs in the simulation.
                Only `hard-light` (8 pairs, uniform `baseFrequency`)
                and `overlay` (4 pairs, varied `baseFrequency`) cleared
                the bar. We pick `hard-light` because it keeps all
                eight noise sources contributing — `hard-light(a, b)`
                pivots on whether `b > 0.5`, making it variance-
                preserving in both directions instead of biased toward
                one extreme. */}
            <feBlend in="offsetNoise1" in2="offsetNoise2" mode="hard-light" result="part1" />
            <feBlend in="offsetNoise3" in2="offsetNoise4" mode="hard-light" result="part2" />
            <feBlend in="offsetNoise5" in2="offsetNoise6" mode="hard-light" result="part3" />
            <feBlend in="offsetNoise7" in2="offsetNoise8" mode="hard-light" result="part4" />
            <feBlend in="part1" in2="part2" mode="hard-light" result="combo12" />
            <feBlend in="part3" in2="part4" mode="hard-light" result="combo34" />
            <feBlend in="combo12" in2="combo34" mode="hard-light" result="combinedNoise" />

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
