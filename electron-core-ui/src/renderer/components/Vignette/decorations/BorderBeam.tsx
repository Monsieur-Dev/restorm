import React from 'react'

// Adapted from Magic UI (MIT) — https://magicui.design/docs/components/border-beam
// Animation reimplemented with CSS keyframes (offset-path) to avoid a runtime dep on motion.

export interface BorderBeamProps {
  /** Length of the moving trail, in pixels. */
  size?: number
  /** Duration of one full lap around the border, in seconds. */
  duration?: number
  /** Delay before the beam starts, in seconds. */
  delay?: number
  /** First gradient stop color of the trail. */
  colorFrom?: string
  /** Second gradient stop color of the trail. */
  colorTo?: string
  /** Reverse the travel direction. */
  reverse?: boolean
  /** Initial position around the border (0-100, percent of one lap). */
  initialOffset?: number
  /** Border width of the beam ring, in pixels. */
  borderWidth?: number
}

export const BorderBeam: React.FC<BorderBeamProps> = ({
  size = 50,
  duration = 6,
  delay = 0,
  colorFrom = '#ffaa40',
  colorTo = '#9c40ff',
  reverse = false,
  initialOffset = 0,
  borderWidth = 1
}) => {
  const offsetSeconds = (initialOffset / 100) * duration

  const ringStyle: React.CSSProperties = {
    ['--ecu-border-beam-width' as string]: `${borderWidth}px`
  }
  const trailStyle: React.CSSProperties = {
    width: `${size}px`,
    offsetPath: `rect(0 auto auto 0 round ${size}px)`,
    background: `linear-gradient(to left, ${colorFrom}, ${colorTo}, transparent)`,
    animationDuration: `${duration}s`,
    animationDelay: `${-(offsetSeconds + delay)}s`,
    animationDirection: reverse ? 'reverse' : 'normal'
  }

  return (
    <div className="ecu-vignette-decoration ecu-vignette-decoration-border-beam" style={ringStyle}>
      <div className="ecu-vignette-decoration-border-beam-trail" style={trailStyle} />
    </div>
  )
}
