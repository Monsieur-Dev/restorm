import React from 'react'
import { NeuroNoise as PaperNeuroNoise } from '@paper-design/shaders-react'

// Wraps @paper-design/shaders-react's NeuroNoise as a full-bleed wallpaper layer.
// The shader paints a fluid web of glowing intersections; we just size it to the
// container and forward the visual params.

export interface NeuroNoiseProps {
  colorFront?: string
  colorMid?: string
  colorBack?: string
  brightness?: number
  contrast?: number
  speed?: number
  scale?: number
  rotation?: number
}

export const NeuroNoise: React.FC<NeuroNoiseProps> = ({
  colorFront,
  colorMid,
  colorBack,
  brightness,
  contrast,
  speed,
  scale,
  rotation
}) => {
  return (
    <PaperNeuroNoise
      className="ecu-wallpaper-pattern-neuro-noise"
      {...(colorFront !== undefined ? { colorFront } : {})}
      {...(colorMid !== undefined ? { colorMid } : {})}
      {...(colorBack !== undefined ? { colorBack } : {})}
      {...(brightness !== undefined ? { brightness } : {})}
      {...(contrast !== undefined ? { contrast } : {})}
      {...(speed !== undefined ? { speed } : {})}
      {...(scale !== undefined ? { scale } : {})}
      {...(rotation !== undefined ? { rotation } : {})}
    />
  )
}
