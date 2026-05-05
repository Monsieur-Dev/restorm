import React from 'react'
import './shineBorder.css'

// Adapted from Magic UI (MIT) — https://magicui.design/docs/components/shine-border

export interface ShineBorderProps {
  /** Border ring width in pixels. */
  borderWidth?: number
  /** Duration of one full shine cycle, in seconds. */
  duration?: number
  /** Single color or array of colors that compose the shine gradient. */
  shineColor?: string | string[]
}

export const ShineBorder: React.FC<ShineBorderProps> = ({
  borderWidth = 1,
  duration = 14,
  shineColor = '#000000'
}) => {
  const colors = Array.isArray(shineColor) ? shineColor.join(',') : shineColor
  const style: React.CSSProperties = {
    ['--ecu-shine-border-width' as string]: `${borderWidth}px`,
    ['--ecu-shine-border-duration' as string]: `${duration}s`,
    backgroundImage: `radial-gradient(transparent, transparent, ${colors}, transparent, transparent)`
  }
  return <div className="ecu-border-effect ecu-shine-border" style={style} />
}
