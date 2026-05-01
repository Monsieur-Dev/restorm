import React from 'react'
import { Warp as PaperWarp } from '@paper-design/shaders-react'

// Wraps @paper-design/shaders-react's Warp as a full-bleed wallpaper layer.
// The shader paints animated color fields warped by noise + swirl over a
// base pattern (checks / stripes / edge); we just size it to the container
// and forward the visual params.

export interface WarpProps {
  colors?: string[]
  proportion?: number
  softness?: number
  shape?: 'checks' | 'stripes' | 'edge'
  shapeScale?: number
  distortion?: number
  swirl?: number
  swirlIterations?: number
  speed?: number
  scale?: number
  rotation?: number
}

export const Warp: React.FC<WarpProps> = ({
  colors,
  proportion,
  softness,
  shape,
  shapeScale,
  distortion,
  swirl,
  swirlIterations,
  speed,
  scale,
  rotation
}) => {
  return (
    <PaperWarp
      className="ecu-wallpaper-pattern-warp"
      {...(colors !== undefined ? { colors } : {})}
      {...(proportion !== undefined ? { proportion } : {})}
      {...(softness !== undefined ? { softness } : {})}
      {...(shape !== undefined ? { shape } : {})}
      {...(shapeScale !== undefined ? { shapeScale } : {})}
      {...(distortion !== undefined ? { distortion } : {})}
      {...(swirl !== undefined ? { swirl } : {})}
      {...(swirlIterations !== undefined ? { swirlIterations } : {})}
      {...(speed !== undefined ? { speed } : {})}
      {...(scale !== undefined ? { scale } : {})}
      {...(rotation !== undefined ? { rotation } : {})}
    />
  )
}
