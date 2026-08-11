export type WallpaperPatternId =
  | 'flickering-grid'
  | 'animated-grid-pattern'
  | 'hexagon-pattern'
  | 'interactive-grid-pattern'
  | 'meteors'
  | 'globe'
  | 'sparkles'
  | 'vortex'
  | 'neuro-noise'
  | 'warp'
  | 'grain-gradient'
  | 'mesh-gradient'
  | 'smoke-ring'
  | 'gem-smoke'
  | 'liquid-metal'

export const wallpaperPatternIds: readonly WallpaperPatternId[] = [
  'flickering-grid',
  'animated-grid-pattern',
  'hexagon-pattern',
  'interactive-grid-pattern',
  'meteors',
  'globe',
  'sparkles',
  'vortex',
  'neuro-noise',
  'warp',
  'grain-gradient',
  'mesh-gradient',
  'smoke-ring',
  'gem-smoke',
  'liquid-metal'
]

export function pickRandomWallpaperPattern(): WallpaperPatternId {
  const pool = wallpaperPatternIds.filter((id) => isPatternSupported(id))
  const idx = Math.floor(Math.random() * pool.length)
  return pool[idx] ?? 'flickering-grid'
}

/**
 * Returns false for patterns whose runtime requirements aren't satisfied —
 * currently just `globe`, which needs WebGL. Used to exclude broken patterns
 * from the random pool so the fallback path never renders an empty canvas.
 */
function isPatternSupported(id: WallpaperPatternId): boolean {
  if (id === 'globe' || id === 'neuro-noise' || id === 'warp' || id === 'grain-gradient' || id === 'mesh-gradient' || id === 'smoke-ring' || id === 'gem-smoke' || id === 'liquid-metal') return hasWebGL()
  return true
}

let webglProbeResult: boolean | null = null
function hasWebGL(): boolean {
  if (webglProbeResult !== null) return webglProbeResult
  if (typeof document === 'undefined') return false
  try {
    const probe = document.createElement('canvas')
    webglProbeResult =
      probe.getContext('webgl') !== null || probe.getContext('webgl2') !== null
  } catch {
    webglProbeResult = false
  }
  return webglProbeResult
}

export { FlickeringGrid } from './FlickeringGrid'
export { AnimatedGridPattern } from './AnimatedGridPattern'
export { HexagonPattern } from './HexagonPattern'
export { InteractiveGridPattern } from './InteractiveGridPattern'
export { Meteors } from './Meteors'
export { Globe } from './Globe'
export { Sparkles } from './Sparkles'
export { Vortex } from './Vortex'
export { NeuroNoise } from './NeuroNoise'
export { Warp } from './Warp'
export { GrainGradient } from './GrainGradient'
export { MeshGradient } from './MeshGradient'
export { SmokeRing } from './SmokeRing'
export { GemSmoke } from './GemSmoke'
export { LiquidMetal } from './LiquidMetal'
export {
  pickRandomFlickeringGridProps,
  pickRandomAnimatedGridPatternProps,
  pickRandomHexagonPatternProps,
  pickRandomInteractiveGridPatternProps,
  pickRandomMeteorsProps,
  pickRandomGlobeProps,
  pickRandomSparklesProps,
  pickRandomVortexProps,
  pickRandomNeuroNoiseProps,
  pickRandomWarpProps,
  pickRandomGrainGradientProps,
  pickRandomMeshGradientProps,
  pickRandomSmokeRingProps,
  pickRandomGemSmokeProps,
  pickRandomLiquidMetalProps,
  pickRandomMaskStyle
} from './random'
