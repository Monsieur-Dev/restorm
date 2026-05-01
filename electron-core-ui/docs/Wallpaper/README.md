# Wallpaper

Decorative background layer that fills its nearest positioned ancestor and renders one of several animated patterns behind sibling content.

## Overview

The `Wallpaper` component renders an absolutely positioned layer (`position: absolute; inset: 0`) that fills the bounds of its nearest positioned ancestor. Make the parent `position: relative` (or any positioned value) to scope the wallpaper to that region — a panel, a card, or the whole viewport — depending on which ancestor establishes the containing block.

It is purely decorative: pointer events pass through to the layers above (with the deliberate exception of `interactive-grid-pattern`, see below), and screen readers ignore it via `aria-hidden`.

Each built-in pattern is wrapped in a randomized **mask + skew** envelope that gives every mount a slightly different "spotlight + diagonal stretch" feel, à la magicui marketing pages. Patterns whose visuals don't tolerate the wrapper (interactive grids, full-screen meteor showers, the centered globe, the canvas-driven vortex) opt out automatically.

## Installation

```typescript
import { Wallpaper } from 'electron-core-ui/renderer'
```

## Component

### Wallpaper

#### Props

```typescript
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

export type WallpaperPattern = WallpaperPatternId | 'random'

export interface WallpaperProps {
  /** Built-in decorative pattern. Pass `'random'` to pick one at mount time. */
  pattern?: WallpaperPattern
  /** Optional content rendered inside the wallpaper layer (e.g. custom patterns, gradients). */
  children?: React.ReactNode
  /** Optional className appended to the root for custom styling. */
  className?: string
  /** Optional inline style overrides on the root. */
  style?: React.CSSProperties
  /** Optional test id for stable E2E selectors. */
  'data-testid'?: string
}
```

#### Built-in patterns

| Pattern id | Source | What it does |
|---|---|---|
| `flickering-grid` | Magic UI (MIT, ported) | Canvas grid where each dot independently flickers in/out at a random opacity. |
| `animated-grid-pattern` | Magic UI (MIT, ported, motion replaced by CSS keyframes) | SVG grid with N highlighted squares that fade in/out and reposition randomly. |
| `hexagon-pattern` | Magic UI (MIT, ported) | Static SVG honeycomb of hexagons (flat-top or pointy-top), supports dashed strokes. |
| `interactive-grid-pattern` | Magic UI (MIT, ported, hover via document-level `mousemove`) | Grid of cells; the cell under the cursor lights up — works through overlays (Vignette etc.) because pointer tracking happens at the document level. |
| `meteors` | Magic UI (MIT, ported, motion replaced by CSS) | Diagonal meteor shower with randomized spawn from the top edge and the right edge so every corner gets traversed. |
| `globe` | Aceternity UI (MIT, ported, depends on `cobe`) | WebGL auto-rotating globe with markers; falls back gracefully if WebGL isn't available (the `random` pool excludes it on systems without WebGL). |
| `sparkles` | Aceternity UI (MIT, port wraps `@tsparticles/react`) | Twinkling particles via tsparticles, theme-derived color. |
| `vortex` | Aceternity UI (MIT, ported, depends on `simplex-noise`) | Curl-noise particle vortex on canvas with neon strokes. |
| `neuro-noise` | Paper Design (MIT, wraps `@paper-design/shaders-react`) | WebGL fragment shader that paints a fluid web of glowing intersections; theme-derived back / mid / front colors, randomized speed / scale / rotation. Excluded from `random` when WebGL isn't available. |
| `warp` | Paper Design (MIT, wraps `@paper-design/shaders-react`) | WebGL "fluid marbled" gradient warped by noise + swirl over a base shape (checks / stripes / edge); 5-7 stops derived from the editor background's hue family. Excluded from `random` without WebGL. |
| `grain-gradient` | Paper Design (MIT, wraps `@paper-design/shaders-react`) | WebGL multi-color gradient with grain-textured distortion in one of 7 forms (wave / dots / truchet / corners / ripple / blob / sphere); `colorBack` = editor background, gradient stops jittered around its hue. Excluded from `random` without WebGL. |
| `mesh-gradient` | Paper Design (MIT, wraps `@paper-design/shaders-react`) | WebGL smooth multi-color mesh (hero-banner style) with optional swirl + grain; 4-6 stops derived from the editor background. Excluded from `random` without WebGL. |

The selected pattern id is exposed on the root as `data-pattern="..."` for testing or theming. When `pattern="random"`, a pattern is picked once at mount and stays stable for the wallpaper's lifetime.

The full list of available pattern ids is exported as `wallpaperPatternIds` for consumers that want to build their own pickers. `pickRandomWallpaperPattern()` is also exported and respects the runtime support filter — patterns that need WebGL (`globe`, `neuro-noise`, `warp`, `grain-gradient`, `mesh-gradient`) are dropped from the random pool when WebGL isn't available.

### Live theme tracking

When the active theme changes — either through `data-theme` attribute swaps on `<html>` (the standard ECUI flow) or through inline `style` mutations on `<html>` (which is how `--editor-background` updates land) — the rendered pattern element is rebuilt with a fresh palette that reads the new background. The pattern id and the random mask wrapper stay fixed for the wallpaper's lifetime; only colour-bearing props re-roll. Patterns that don't read theme tokens (e.g. `globe` markers, `interactive-grid-pattern`) just remount with the same configuration.

#### Per-pattern theming

Most patterns derive their primary color from the editor theme via the `--editor-background` CSS variable: each pattern's randomization picks a color *near* the background (luminance shifted, hue jittered) so it always feels integrated with the active theme rather than dropped on top of it.

The `globe` pattern adapts more aggressively: it inverts dark/light and flips its base color so it stays high-contrast on either theme.

#### Usage

```tsx
import React from 'react'
import { Wallpaper } from 'electron-core-ui/renderer'

export const Panel: React.FC = () => {
  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <Wallpaper />
      <div style={{ position: 'relative', zIndex: 1 }}>
        {/* panel content */}
      </div>
    </div>
  )
}
```

##### With a fixed pattern

```tsx
<Wallpaper pattern="hexagon-pattern" />
```

##### Random pattern at mount

```tsx
<Wallpaper pattern="random" />
```

##### With custom content (no built-in pattern)

```tsx
<Wallpaper>
  <div className="my-gradient-mesh" />
</Wallpaper>
```

## Stacking

The wallpaper is `position: absolute; inset: 0; z-index: 0; pointer-events: none`. Two requirements on the parent:

1. The parent must be positioned (`position: relative` or similar) so the wallpaper anchors to its bounds.
2. Sibling content rendered alongside the wallpaper should establish its own stacking context (`position: relative; z-index: 1` or higher) so it paints on top.

Avoid putting an opaque `background-color` on the parent — it would hide the wallpaper underneath.

## Testing

If you pass a `data-testid`, target the root with `[data-testid="..."]`. The root also exposes `data-pattern="<resolved id>"` once a pattern has been picked, useful for asserting which one was chosen on a given mount.
