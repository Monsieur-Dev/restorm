import React, { useEffect, useMemo, useState } from 'react'
import {
  AnimatedGridPattern,
  FlickeringGrid,
  Globe,
  HexagonPattern,
  InteractiveGridPattern,
  Meteors,
  NeuroNoise,
  Sparkles,
  Vortex,
  Warp,
  GrainGradient,
  MeshGradient,
  SmokeRing,
  GemSmoke,
  LiquidMetal,
  pickRandomAnimatedGridPatternProps,
  pickRandomFlickeringGridProps,
  pickRandomGlobeProps,
  pickRandomGrainGradientProps,
  pickRandomHexagonPatternProps,
  pickRandomInteractiveGridPatternProps,
  pickRandomMaskStyle,
  pickRandomMeshGradientProps,
  pickRandomMeteorsProps,
  pickRandomNeuroNoiseProps,
  pickRandomSmokeRingProps,
  pickRandomGemSmokeProps,
  pickRandomLiquidMetalProps,
  pickRandomSparklesProps,
  pickRandomVortexProps,
  pickRandomWallpaperPattern,
  pickRandomWarpProps,
  type WallpaperPatternId
} from './patterns'
import './wallpaper.css'

export type WallpaperPattern = WallpaperPatternId | 'random'

export interface WallpaperProps {
  /** Built-in decorative pattern. Pass `'random'` to pick one at mount time. */
  pattern?: WallpaperPattern
  /** Optional content rendered inside the wallpaper layer (e.g. decorative patterns, gradients). */
  children?: React.ReactNode
  /** Optional className appended to the root for custom styling. */
  className?: string
  /** Optional inline style overrides on the root. */
  style?: React.CSSProperties
  /** Optional test id for stable E2E selectors. */
  'data-testid'?: string
}

export const Wallpaper: React.FC<WallpaperProps> = ({
  pattern,
  children,
  className,
  style,
  'data-testid': dataTestId
}) => {
  // The pattern id and mask are picked once at mount — switching pattern
  // mid-life would be jarring. Only the rendered element is rebuilt on
  // theme changes so the colours follow the active palette.
  const [identity] = useState<{ id: WallpaperPatternId; maskStyle: React.CSSProperties | null } | null>(() => {
    if (!pattern) return null
    const id: WallpaperPatternId = pattern === 'random' ? pickRandomWallpaperPattern() : pattern
    const maskStyle = PATTERNS_WITHOUT_MASK.has(id) ? null : pickRandomMaskStyle()
    return { id, maskStyle }
  })

  // Bump on every theme switch so the pattern element re-rolls its
  // colour palette (each pattern's `pickRandom*Props` reads
  // `--editor-background` at call time).
  const themeRevision = useThemeRevision()
  // `themeRevision` is the trigger — `identity` is stable for the
  // mount (settled in lazy-init useState), so once it's frozen this
  // only ever re-fires on theme change. Stamping the revision onto
  // the element's `key` keeps it in the deps array honestly *and*
  // forces React to remount the pattern subtree (clean canvas /
  // lottie state) instead of patching props.
  const element = useMemo(
    () => identity
      ? React.cloneElement(buildPatternElement(identity.id), {
          key: `${identity.id}-${themeRevision}`
        })
      : null,
    [identity, themeRevision]
  )

  const classes = ['ecu-wallpaper', className].filter(Boolean).join(' ')
  const dataAttrs = identity ? { 'data-pattern': identity.id } : {}

  return (
    <div
      className={classes}
      style={style}
      data-testid={dataTestId}
      aria-hidden="true"
      {...dataAttrs}
    >
      {identity && element ? (
        identity.maskStyle ? (
          <div className="ecu-wallpaper-mask" style={identity.maskStyle}>
            {element}
          </div>
        ) : (
          element
        )
      ) : null}
      {children}
    </div>
  )
}

/**
 * Returns a counter that increments whenever the active theme changes.
 *
 * Two signals feed into this: the `data-theme` attribute on
 * `<html>` (toggles between `'dark' | 'light' | …` when the user
 * picks a new theme) and the computed value of `--editor-background`
 * (catches edits within the same theme type, e.g. user theme tweaks).
 */
function useThemeRevision(): number {
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const root = document.documentElement
    let lastBackground = window.getComputedStyle(root).getPropertyValue('--editor-background').trim()

    const bump = (): void => {
      const next = window.getComputedStyle(root).getPropertyValue('--editor-background').trim()
      if (next === lastBackground) return
      lastBackground = next
      setRevision((r) => r + 1)
    }

    const observer = new MutationObserver(bump)
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme', 'style'] })
    return () => { observer.disconnect() }
  }, [])
  return revision
}

// Patterns that skip the random mask + skew wrapper. Interactive patterns
// rely on exact pointer-to-cell alignment, which the wrapper's transform and
// vertical overshoot would break. Meteors travel across the whole viewport
// and would get clipped or obscured by the radial mask. Globe is a centered
// hero element that shouldn't be skewed.
const PATTERNS_WITHOUT_MASK: ReadonlySet<WallpaperPatternId> = new Set([
  'interactive-grid-pattern',
  'meteors',
  'globe',
  'vortex',
  'neuro-noise',
  'warp',
  'grain-gradient',
  'mesh-gradient',
  'smoke-ring',
  'gem-smoke',
  'liquid-metal'
])

const PATTERN_BUILDERS: Record<WallpaperPatternId, () => React.ReactElement> = {
  'flickering-grid': () => <FlickeringGrid {...pickRandomFlickeringGridProps()} />,
  'animated-grid-pattern': () => <AnimatedGridPattern {...pickRandomAnimatedGridPatternProps()} />,
  'hexagon-pattern': () => <HexagonPattern {...pickRandomHexagonPatternProps()} />,
  'interactive-grid-pattern': () => (
    <InteractiveGridPattern {...pickRandomInteractiveGridPatternProps()} />
  ),
  meteors: () => <Meteors {...pickRandomMeteorsProps()} />,
  globe: () => <Globe {...pickRandomGlobeProps()} />,
  sparkles: () => <Sparkles {...pickRandomSparklesProps()} />,
  vortex: () => <Vortex {...pickRandomVortexProps()} />,
  'neuro-noise': () => <NeuroNoise {...pickRandomNeuroNoiseProps()} />,
  warp: () => <Warp {...pickRandomWarpProps()} />,
  'grain-gradient': () => <GrainGradient {...pickRandomGrainGradientProps()} />,
  'mesh-gradient': () => <MeshGradient {...pickRandomMeshGradientProps()} />,
  'smoke-ring': () => <SmokeRing {...pickRandomSmokeRingProps()} />,
  'gem-smoke': () => <GemSmoke {...pickRandomGemSmokeProps()} />,
  'liquid-metal': () => <LiquidMetal {...pickRandomLiquidMetalProps()} />
}

function buildPatternElement(id: WallpaperPatternId): React.ReactElement {
  return PATTERN_BUILDERS[id]()
}

export default Wallpaper
