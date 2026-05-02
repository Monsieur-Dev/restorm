import React from 'react'
import { LiquidMetal as PaperLiquidMetal } from '@paper-design/shaders-react'

// Wraps @paper-design/shaders-react's LiquidMetal as a full-bleed
// wallpaper layer. The shader paints a futuristic liquid-metal
// material with animated stripes distorted along the shape's edges.
// We just size it to the container and forward the visual params.

export type LiquidMetalShape = 'none' | 'circle' | 'daisy' | 'diamond' | 'metaballs'

export interface LiquidMetalProps {
  colorBack?: string
  colorTint?: string
  shape?: LiquidMetalShape
  repetition?: number
  shiftRed?: number
  shiftBlue?: number
  contour?: number
  softness?: number
  distortion?: number
  angle?: number
  speed?: number
  scale?: number
  rotation?: number
}

export const LiquidMetal: React.FC<LiquidMetalProps> = ({
  colorBack,
  colorTint,
  shape,
  repetition,
  shiftRed,
  shiftBlue,
  contour,
  softness,
  distortion,
  angle,
  speed,
  scale,
  rotation
}) => {
  return (
    <PaperLiquidMetal
      className="ecu-wallpaper-pattern-liquid-metal"
      {...(colorBack !== undefined ? { colorBack } : {})}
      {...(colorTint !== undefined ? { colorTint } : {})}
      {...(shape !== undefined ? { shape } : {})}
      {...(repetition !== undefined ? { repetition } : {})}
      {...(shiftRed !== undefined ? { shiftRed } : {})}
      {...(shiftBlue !== undefined ? { shiftBlue } : {})}
      {...(contour !== undefined ? { contour } : {})}
      {...(softness !== undefined ? { softness } : {})}
      {...(distortion !== undefined ? { distortion } : {})}
      {...(angle !== undefined ? { angle } : {})}
      {...(speed !== undefined ? { speed } : {})}
      {...(scale !== undefined ? { scale } : {})}
      {...(rotation !== undefined ? { rotation } : {})}
    />
  )
}
