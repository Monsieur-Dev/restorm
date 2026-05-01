import type React from 'react'
import type { AnimatedGridPatternProps } from './AnimatedGridPattern'
import type { FlickeringGridProps } from './FlickeringGrid'
import type { HexagonPatternProps } from './HexagonPattern'
import type { GlobeProps } from './Globe'
import type { InteractiveGridPatternProps } from './InteractiveGridPattern'
import type { MeteorsProps } from './Meteors'
import type { NeuroNoiseProps } from './NeuroNoise'
import type { SparklesProps } from './Sparkles'
import type { VortexProps } from './Vortex'

interface Rgb {
  r: number
  g: number
  b: number
}

interface Hsl {
  h: number
  s: number
  l: number
}

const FALLBACK_BG: Rgb = { r: 30, g: 30, b: 30 }

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function randInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1))
}

function randFloat(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function parseColor(input: string): Rgb | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = input
  ctx.fillRect(0, 0, 1, 1)
  const data = ctx.getImageData(0, 0, 1, 1).data
  return { r: data[0] ?? 0, g: data[1] ?? 0, b: data[2] ?? 0 }
}

function readEditorBackground(): Rgb {
  if (typeof window === 'undefined' || typeof document === 'undefined') return FALLBACK_BG
  const value = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue('--editor-background')
    .trim()
  if (!value) return FALLBACK_BG
  return parseColor(value) ?? FALLBACK_BG
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rN = r / 255
  const gN = g / 255
  const bN = b / 255
  const max = Math.max(rN, gN, bN)
  const min = Math.min(rN, gN, bN)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === rN) h = (gN - bN) / d + (gN < bN ? 6 : 0)
    else if (max === gN) h = (bN - rN) / d + 2
    else h = (rN - gN) / d + 4
    h *= 60
  }
  return { h, s, l }
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) { r = c; g = x; b = 0 }
  else if (h < 120) { r = x; g = c; b = 0 }
  else if (h < 180) { r = 0; g = c; b = x }
  else if (h < 240) { r = 0; g = x; b = c }
  else if (h < 300) { r = x; g = 0; b = c }
  else { r = c; g = 0; b = x }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  }
}

/**
 * Picks a color in the same family as the editor background — close enough
 * to feel like a tint, far enough to be visible. Shifts luminance toward the
 * opposite end (lighter on dark themes, darker on light themes), with a small
 * hue + saturation jitter so the result feels alive instead of mechanical.
 */
function pickColorNearBackground(): string {
  const bg = readEditorBackground()
  const hsl = rgbToHsl(bg)
  const direction = hsl.l < 0.5 ? 1 : -1
  const newL = clamp(hsl.l + direction * randFloat(0.55, 0.8), 0.05, 0.95)
  const newH = (hsl.h + randFloat(-45, 45) + 360) % 360
  const newS = clamp(hsl.s + randFloat(-0.1, 0.35), 0, 1)
  const out = hslToRgb({ h: newH, s: newS, l: newL })
  return `rgb(${out.r}, ${out.g}, ${out.b})`
}

/**
 * Returns a coherent set of randomized props for the Flickering Grid pattern.
 * Square / gap sizes stay in a "small dotted grid" range; flicker chance and
 * max opacity are bumped to stay visible against a near-background color.
 */
export function pickRandomFlickeringGridProps(): FlickeringGridProps {
  return {
    color: pickColorNearBackground(),
    squareSize: randInt(2, 8),
    gridGap: randInt(4, 14),
    flickerChance: randFloat(0.15, 0.4),
    maxOpacity: randFloat(0.55, 0.9)
  }
}

/**
 * Returns a randomized "mask + skew" wrapper style applied around any pattern,
 * inspired by Magic UI's marketing-page treatment: a soft radial gradient
 * spotlight, a slight Y-skew, and a vertical overshoot that lets the pattern
 * bleed past the wallpaper bounds for a more dynamic feel.
 */
export function pickRandomMaskStyle(): React.CSSProperties {
  const shape = Math.random() < 0.7 ? 'circle' : 'ellipse'
  const extent = Math.random() < 0.65 ? 'farthest-corner' : 'farthest-side'

  const positions = ['center', 'center', 'center', 'center 40%', 'center 60%', '45% 50%', '55% 50%']
  const position = positions[Math.floor(Math.random() * positions.length)] ?? 'center'

  const innerStop = randInt(15, 45)
  const outerStop = randInt(80, 100)

  const skewY = randFloat(-14, 14)
  const insetPct = randFloat(0.15, 0.4)
  const insetTop = `${-Math.round(insetPct * 100)}%`
  const insetBottom = insetTop
  const height = `${Math.round(100 + insetPct * 200)}%`

  const gradient = `radial-gradient(${shape} ${extent} at ${position}, white ${innerStop}%, transparent ${outerStop}%)`

  return {
    position: 'absolute',
    left: 0,
    right: 0,
    top: insetTop,
    bottom: insetBottom,
    height,
    transform: `skewY(${skewY.toFixed(1)}deg)`,
    maskImage: gradient,
    WebkitMaskImage: gradient
  }
}

/**
 * Returns a coherent set of randomized props for the Animated Grid pattern.
 * Cell size stays in a comfortable mid-range; the dasharray flips between
 * solid and a couple of dash flavours; opacity is bumped to remain visible
 * against a near-background color.
 */
/**
 * Returns a coherent set of randomized props for the Interactive Grid pattern.
 * Cells stay in a comfortable click-target size; opacities are nudged so the
 * grid is subtle at rest and clearly readable on hover.
 */
export function pickRandomInteractiveGridPatternProps(): InteractiveGridPatternProps {
  return {
    color: pickColorNearBackground(),
    cellSize: randInt(32, 64),
    strokeOpacity: randFloat(0.2, 0.45),
    hoverOpacity: randFloat(0.25, 0.5)
  }
}

/**
 * Returns a coherent set of randomized props for the Globe pattern. Picks
 * theme-friendly base / glow colors and spawns a sparse, jittery set of
 * marker dots so each mount feels different.
 */
export function pickRandomGlobeProps(): GlobeProps {
  // Cobe defaults are tuned for a dark backdrop (white globe). On a light
  // app theme we flip: a dark globe with a slight tint stays visible. `dark`
  // shades the dot-map; baseColor sets the sphere body; glowColor is the rim
  // halo; markerColor lights up the marker pulses.
  const bgIsDark = isBackgroundDark()
  const baseColor: [number, number, number] = bgIsDark
    ? [1, 1, 1]
    : [0.12, 0.12, 0.18]
  const glowColor: [number, number, number] = bgIsDark
    ? [1, 1, 1]
    : [0.35, 0.35, 0.5]
  const markerColor = pickVividMarkerColor()

  const markerCount = randInt(8, 18)
  const markers = Array.from({ length: markerCount }, () => ({
    location: [randFloat(-60, 70), randFloat(-180, 180)] as [number, number],
    size: randFloat(0.03, 0.12)
  }))

  return {
    config: {
      dark: bgIsDark ? 0 : 1,
      diffuse: randFloat(0.3, 0.7),
      mapBrightness: randFloat(1.0, 1.6),
      mapSamples: 16000,
      baseColor,
      glowColor,
      markerColor,
      markers
    }
  }
}

function isBackgroundDark(): boolean {
  const bg = readEditorBackground()
  const luminance = (0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b) / 255
  return luminance < 0.5
}

function pickVividMarkerColor(): [number, number, number] {
  const hue = Math.random() * 360
  const saturation = 0.85
  const lightness = 0.6
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = lightness - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (hue < 60) { r = c; g = x }
  else if (hue < 120) { r = x; g = c }
  else if (hue < 180) { g = c; b = x }
  else if (hue < 240) { g = x; b = c }
  else if (hue < 300) { r = x; b = c }
  else { r = c; b = x }
  return [r + m, g + m, b + m]
}

/**
 * Returns a coherent set of randomized props for the Meteors pattern.
 * Density, lifetime and travel distance are randomized; the fall direction
 * stays in a believable diagonal range so it always feels like a shower.
 */
export function pickRandomMeteorsProps(): MeteorsProps {
  return {
    color: pickColorNearBackground(),
    number: randInt(15, 32),
    minDuration: randFloat(3, 5),
    maxDuration: randFloat(8, 14),
    minDelay: randFloat(0.1, 0.5),
    maxDelay: randFloat(1, 2.5),
    angle: randInt(35, 60),
    trailLength: randInt(40, 90),
    travelDistance: randInt(700, 1300)
  }
}

/**
 * Returns a coherent set of randomized props for the Vortex pattern.
 * Particle density and motion settings stay in cinematic ranges; the base
 * hue is fully randomized so each launch picks a different mood (cyan,
 * purple, magenta, orange, ...). Background follows the editor theme.
 */
export function pickRandomVortexProps(): VortexProps {
  const bg = readEditorBackground()
  return {
    backgroundColor: `rgb(${bg.r}, ${bg.g}, ${bg.b})`,
    particleCount: randInt(900, 1500),
    baseHue: randInt(0, 359),
    baseSpeed: randFloat(0, 0.3),
    rangeSpeed: randFloat(1.0, 2.2),
    baseRadius: randFloat(1, 1.8),
    rangeRadius: randFloat(1.5, 3.2),
    rangeY: randInt(60, 160)
  }
}

/**
 * Returns a coherent set of randomized props for the Sparkles pattern.
 * Particle color follows the theme (more contrasted than near-bg patterns
 * because sparkles are small and need to pop). Density and twinkle speed are
 * randomized in cinematic ranges.
 */
export function pickRandomSparklesProps(): SparklesProps {
  return {
    particleColor: pickColorNearBackground(),
    minSize: randFloat(0.6, 1.2),
    maxSize: randFloat(2, 4),
    particleDensity: randInt(80, 200),
    speed: randFloat(2.5, 6)
  }
}

/**
 * Returns a coherent set of randomized props for the Hexagon pattern.
 * Radius stays mid-range, dash style is mostly solid with occasional dashes,
 * direction flips evenly between flat-top and pointy-top.
 */
export function pickRandomHexagonPatternProps(): HexagonPatternProps {
  const dashChoices = ['0', '0', '0', '4', '4 4', '2 6']
  const dash = dashChoices[Math.floor(Math.random() * dashChoices.length)] ?? '0'
  return {
    color: pickColorNearBackground(),
    radius: randInt(22, 55),
    gap: randInt(0, 6),
    direction: Math.random() < 0.5 ? 'horizontal' : 'vertical',
    strokeDasharray: dash,
    strokeOpacity: randFloat(0.35, 0.65)
  }
}

/**
 * Returns a coherent set of randomized props for the NeuroNoise shader.
 * Background derives from the editor theme so the wallpaper integrates with
 * the surrounding UI; mid + front colors are picked from a vivid palette so
 * the fluid web stays clearly visible. Speed, scale and rotation pull from
 * cinematic ranges that keep the motion calm but never static.
 */
export function pickRandomNeuroNoiseProps(): NeuroNoiseProps {
  const bg = readEditorBackground()
  const colorBack = `rgb(${bg.r}, ${bg.g}, ${bg.b})`
  const bgIsDark = isBackgroundDark()
  const baseHue = randFloat(0, 360)
  const midL = bgIsDark ? randFloat(0.45, 0.6) : randFloat(0.35, 0.5)
  const frontL = bgIsDark ? randFloat(0.75, 0.95) : randFloat(0.2, 0.35)
  const colorMid = hslToRgbString({ h: baseHue, s: randFloat(0.55, 0.85), l: midL })
  const colorFront = hslToRgbString({
    h: (baseHue + randFloat(-30, 30) + 360) % 360,
    s: randFloat(0.4, 0.8),
    l: frontL
  })
  return {
    colorBack,
    colorMid,
    colorFront,
    brightness: randFloat(0.6, 1.0),
    contrast: randFloat(0.4, 0.7),
    speed: randFloat(0.4, 1.1),
    scale: randFloat(0.6, 1.4),
    rotation: randFloat(0, 360)
  }
}

function hslToRgbString(hsl: Hsl): string {
  const rgb = hslToRgb(hsl)
  return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`
}

export function pickRandomAnimatedGridPatternProps(): AnimatedGridPatternProps {
  const cell = randInt(28, 56)
  const dashChoices = [0, 0, 2, 4]
  const idx = Math.floor(Math.random() * dashChoices.length)
  return {
    color: pickColorNearBackground(),
    width: cell,
    height: cell,
    numSquares: randInt(30, 80),
    maxOpacity: randFloat(0.45, 0.85),
    duration: randFloat(2.5, 5.5),
    repeatDelay: randFloat(0.3, 1.5),
    strokeDasharray: dashChoices[idx] ?? 0
  }
}
