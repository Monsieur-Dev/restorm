import React, { useState } from 'react'
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
  pickRandomAnimatedGridPatternProps,
  pickRandomFlickeringGridProps,
  pickRandomGlobeProps,
  pickRandomHexagonPatternProps,
  pickRandomInteractiveGridPatternProps,
  pickRandomMaskStyle,
  pickRandomMeteorsProps,
  pickRandomNeuroNoiseProps,
  pickRandomSparklesProps,
  pickRandomVortexProps,
  pickRandomWallpaperPattern,
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
  const [resolved] = useState<{
    id: WallpaperPatternId
    element: React.ReactElement
    maskStyle: React.CSSProperties | null
  } | null>(() => {
    if (!pattern) return null
    const id: WallpaperPatternId = pattern === 'random' ? pickRandomWallpaperPattern() : pattern
    const maskStyle = PATTERNS_WITHOUT_MASK.has(id) ? null : pickRandomMaskStyle()
    return { id, element: buildPatternElement(id), maskStyle }
  })

  const classes = ['ecu-wallpaper', className].filter(Boolean).join(' ')
  const dataAttrs = resolved ? { 'data-pattern': resolved.id } : {}

  return (
    <div
      className={classes}
      style={style}
      data-testid={dataTestId}
      aria-hidden="true"
      {...dataAttrs}
    >
      {resolved ? (
        resolved.maskStyle ? (
          <div className="ecu-wallpaper-mask" style={resolved.maskStyle}>
            {resolved.element}
          </div>
        ) : (
          resolved.element
        )
      ) : null}
      {children}
    </div>
  )
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
  'neuro-noise'
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
  'neuro-noise': () => <NeuroNoise {...pickRandomNeuroNoiseProps()} />
}

function buildPatternElement(id: WallpaperPatternId): React.ReactElement {
  return PATTERN_BUILDERS[id]()
}

export default Wallpaper
