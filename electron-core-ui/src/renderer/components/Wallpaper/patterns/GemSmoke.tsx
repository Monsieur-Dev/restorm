import React from 'react'
import { GemSmoke as PaperGemSmoke } from '@paper-design/shaders-react'

// Wraps @paper-design/shaders-react's GemSmoke as a full-bleed wallpaper
// layer. The shader paints a glassy shape (circle / daisy / diamond /
// metaballs) with a slowly drifting smoky color field behind it. We
// just size it to the container and forward the visual params.

export type GemSmokeShape = 'none' | 'circle' | 'daisy' | 'diamond' | 'metaballs'

export interface GemSmokeProps {
  colorBack?: string
  colorInner?: string
  colors?: string[]
  shape?: GemSmokeShape
  innerDistortion?: number
  outerDistortion?: number
  innerGlow?: number
  outerGlow?: number
  offset?: number
  angle?: number
  size?: number
  speed?: number
  scale?: number
  rotation?: number
}

export const GemSmoke: React.FC<GemSmokeProps> = ({
  colorBack,
  colorInner,
  colors,
  shape,
  innerDistortion,
  outerDistortion,
  innerGlow,
  outerGlow,
  offset,
  angle,
  size,
  speed,
  scale,
  rotation
}) => {
  return (
    <PaperGemSmoke
      className="ecu-wallpaper-pattern-gem-smoke"
      {...(colorBack !== undefined ? { colorBack } : {})}
      {...(colorInner !== undefined ? { colorInner } : {})}
      {...(colors !== undefined ? { colors } : {})}
      {...(shape !== undefined ? { shape } : {})}
      {...(innerDistortion !== undefined ? { innerDistortion } : {})}
      {...(outerDistortion !== undefined ? { outerDistortion } : {})}
      {...(innerGlow !== undefined ? { innerGlow } : {})}
      {...(outerGlow !== undefined ? { outerGlow } : {})}
      {...(offset !== undefined ? { offset } : {})}
      {...(angle !== undefined ? { angle } : {})}
      {...(size !== undefined ? { size } : {})}
      {...(speed !== undefined ? { speed } : {})}
      {...(scale !== undefined ? { scale } : {})}
      {...(rotation !== undefined ? { rotation } : {})}
    />
  )
}
