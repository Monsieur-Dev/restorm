import React, { useId } from 'react'
import './electricBorder.css'

// Adapted from Bálint Ferenczy's "Animated Electric Border CSS Card"
// (https://codepen.io/BalintFerenczy/pen/KwdoyEN, MIT-style demo).
// The original is a single static SVG filter consumed by a single card;
// this port:
//   - generates a per-instance filter id (via React's `useId`) so several
//     ElectricBorders can coexist on the same page without their animated
//     <feOffset>s sharing state,
//   - exposes color, border width and animation duration as props (mapped
//     to CSS vars on the root + the <animate> dur attribute),
//   - drops the original card's content / typography concerns: this is an
//     overlay effect, not a card layout.

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
            x="-20%"
            y="-20%"
            width="140%"
            height="140%"
          >
            {/* Four turbulence/offset pairs whose `dy` and `dx` animate
                in opposite directions — composited together to produce
                the flowing "electric" wobble. Same recipe as the
                original codepen, durations tied to the `duration` prop. */}
            <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="10" result="noise1" seed="1" />
            <feOffset in="noise1" dx="0" dy="0" result="offsetNoise1">
              <animate attributeName="dy" values="700; 0" dur={`${duration}s`} repeatCount="indefinite" calcMode="linear" />
            </feOffset>

            <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="10" result="noise2" seed="1" />
            <feOffset in="noise2" dx="0" dy="0" result="offsetNoise2">
              <animate attributeName="dy" values="0; -700" dur={`${duration}s`} repeatCount="indefinite" calcMode="linear" />
            </feOffset>

            <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="10" result="noise3" seed="2" />
            <feOffset in="noise3" dx="0" dy="0" result="offsetNoise3">
              <animate attributeName="dx" values="490; 0" dur={`${duration}s`} repeatCount="indefinite" calcMode="linear" />
            </feOffset>

            <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="10" result="noise4" seed="2" />
            <feOffset in="noise4" dx="0" dy="0" result="offsetNoise4">
              <animate attributeName="dx" values="0; -490" dur={`${duration}s`} repeatCount="indefinite" calcMode="linear" />
            </feOffset>

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
