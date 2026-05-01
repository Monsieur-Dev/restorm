import React from 'react'
import { MeshGradient as PaperMeshGradient } from '@paper-design/shaders-react'

// Wraps @paper-design/shaders-react's MeshGradient as a full-bleed
// wallpaper layer. The shader paints a smooth multi-colour mesh
// (think hero-banner gradients) with optional swirl + grain. We size
// it to the container and forward the visual params.

export interface MeshGradientProps {
  colors?: string[]
  distortion?: number
  swirl?: number
  grainMixer?: number
  grainOverlay?: number
  speed?: number
  scale?: number
  rotation?: number
}

export const MeshGradient: React.FC<MeshGradientProps> = ({
  colors,
  distortion,
  swirl,
  grainMixer,
  grainOverlay,
  speed,
  scale,
  rotation
}) => {
  return (
    <PaperMeshGradient
      className="ecu-wallpaper-pattern-mesh-gradient"
      {...(colors !== undefined ? { colors } : {})}
      {...(distortion !== undefined ? { distortion } : {})}
      {...(swirl !== undefined ? { swirl } : {})}
      {...(grainMixer !== undefined ? { grainMixer } : {})}
      {...(grainOverlay !== undefined ? { grainOverlay } : {})}
      {...(speed !== undefined ? { speed } : {})}
      {...(scale !== undefined ? { scale } : {})}
      {...(rotation !== undefined ? { rotation } : {})}
    />
  )
}
