import React from 'react'
import { GrainGradient as PaperGrainGradient } from '@paper-design/shaders-react'

// Wraps @paper-design/shaders-react's GrainGradient as a full-bleed
// wallpaper layer. The shader paints a multi-colour gradient with
// grain-textured distortion in one of 7 animated forms (wave, dots,
// truchet, corners, ripple, blob, sphere). We just size it to the
// container and forward the visual params.

export type GrainGradientShape =
  | 'wave'
  | 'dots'
  | 'truchet'
  | 'corners'
  | 'ripple'
  | 'blob'
  | 'sphere'

export interface GrainGradientProps {
  colorBack?: string
  colors?: string[]
  softness?: number
  intensity?: number
  noise?: number
  shape?: GrainGradientShape
  speed?: number
  scale?: number
  rotation?: number
}

export const GrainGradient: React.FC<GrainGradientProps> = ({
  colorBack,
  colors,
  softness,
  intensity,
  noise,
  shape,
  speed,
  scale,
  rotation
}) => {
  return (
    <PaperGrainGradient
      className="ecu-wallpaper-pattern-grain-gradient"
      {...(colorBack !== undefined ? { colorBack } : {})}
      {...(colors !== undefined ? { colors } : {})}
      {...(softness !== undefined ? { softness } : {})}
      {...(intensity !== undefined ? { intensity } : {})}
      {...(noise !== undefined ? { noise } : {})}
      {...(shape !== undefined ? { shape } : {})}
      {...(speed !== undefined ? { speed } : {})}
      {...(scale !== undefined ? { scale } : {})}
      {...(rotation !== undefined ? { rotation } : {})}
    />
  )
}
