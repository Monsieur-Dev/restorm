import React from 'react'
import { SmokeRing as PaperSmokeRing } from '@paper-design/shaders-react'

// Wraps @paper-design/shaders-react's SmokeRing as a full-bleed wallpaper
// layer. The shader paints a slowly-rotating ring of volumetric smoke; we
// just size it to the container and forward the visual params.

export interface SmokeRingProps {
  colorBack?: string
  colors?: string[]
  noiseScale?: number
  noiseIterations?: number
  radius?: number
  thickness?: number
  innerShape?: number
  speed?: number
  scale?: number
  rotation?: number
}

export const SmokeRing: React.FC<SmokeRingProps> = ({
  colorBack,
  colors,
  noiseScale,
  noiseIterations,
  radius,
  thickness,
  innerShape,
  speed,
  scale,
  rotation
}) => {
  return (
    <PaperSmokeRing
      className="ecu-wallpaper-pattern-smoke-ring"
      {...(colorBack !== undefined ? { colorBack } : {})}
      {...(colors !== undefined ? { colors } : {})}
      {...(noiseScale !== undefined ? { noiseScale } : {})}
      {...(noiseIterations !== undefined ? { noiseIterations } : {})}
      {...(radius !== undefined ? { radius } : {})}
      {...(thickness !== undefined ? { thickness } : {})}
      {...(innerShape !== undefined ? { innerShape } : {})}
      {...(speed !== undefined ? { speed } : {})}
      {...(scale !== undefined ? { scale } : {})}
      {...(rotation !== undefined ? { rotation } : {})}
    />
  )
}
