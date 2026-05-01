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

export const wallpaperPatternIds: readonly WallpaperPatternId[] = [
  'flickering-grid',
  'animated-grid-pattern',
  'hexagon-pattern',
  'interactive-grid-pattern',
  'meteors',
  'globe',
  'sparkles',
  'vortex',
  'neuro-noise'
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
  if (id === 'globe' || id === 'neuro-noise') return hasWebGL()
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
export type { FlickeringGridProps } from './FlickeringGrid'
export { AnimatedGridPattern } from './AnimatedGridPattern'
export type { AnimatedGridPatternProps } from './AnimatedGridPattern'
export { HexagonPattern } from './HexagonPattern'
export type { HexagonPatternProps, HexagonDirection } from './HexagonPattern'
export { InteractiveGridPattern } from './InteractiveGridPattern'
export type { InteractiveGridPatternProps } from './InteractiveGridPattern'
export { Meteors } from './Meteors'
export type { MeteorsProps } from './Meteors'
export { Globe } from './Globe'
export type { GlobeProps } from './Globe'
export { Sparkles } from './Sparkles'
export type { SparklesProps } from './Sparkles'
export { Vortex } from './Vortex'
export type { VortexProps } from './Vortex'
export { NeuroNoise } from './NeuroNoise'
export type { NeuroNoiseProps } from './NeuroNoise'
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
  pickRandomMaskStyle
} from './random'
