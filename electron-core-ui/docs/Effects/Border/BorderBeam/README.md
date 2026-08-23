# BorderBeam

A short colored gradient trail that loops continuously along its parent's border.

## Overview

`BorderBeam` overlays its parent with a 1px-wide ring (mask-composited from `border-box ∖ padding-box`) and animates a small gradient div along that ring via CSS `offset-path`. The result reads as a thin "comet" tracing the rounded rectangle that contains it — useful to draw attention to a card, a CTA, or a marketing pitch tile.

Adapted from [Magic UI](https://magicui.design/docs/components/border-beam) (MIT). The original used `motion` for the loop; the port replaces that with a CSS keyframe (`offset-distance: 0% → 100%`) so the loop runs without a JS frame.

## Installation

```typescript
import { BorderBeam } from 'electron-core-ui/renderer'
```

## Component

### BorderBeam

#### Props

```typescript
export interface BorderBeamProps {
  /** Length of the moving trail, in pixels. */
  size?: number
  /** Duration of one full lap around the border, in seconds. */
  duration?: number
  /** Delay before the beam starts, in seconds. */
  delay?: number
  /** First gradient stop color of the trail. */
  colorFrom?: string
  /** Second gradient stop color of the trail. */
  colorTo?: string
  /** Reverse the travel direction. */
  reverse?: boolean
  /** Initial position around the border (0-100, percent of one lap). */
  initialOffset?: number
  /** Border width of the beam ring, in pixels. */
  borderWidth?: number
}
```

Defaults: `size: 50`, `duration: 6`, `delay: 0`, `colorFrom: '#ffaa40'`, `colorTo: '#9c40ff'`, `reverse: false`, `initialOffset: 0`, `borderWidth: 1`.

#### Usage

```tsx
import { BorderBeam } from 'electron-core-ui/renderer'

export const HighlightedCard: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ position: 'relative', borderRadius: 12, padding: 16 }}>
    {children}
    <BorderBeam size={60} duration={6} />
  </div>
)
```

The parent must establish a containing block (`position: relative`) and ideally have a non-zero `border-radius` for the beam to look right.

## Random props

```typescript
import { pickRandomBorderBeamProps } from 'electron-core-ui/renderer'

<BorderBeam {...pickRandomBorderBeamProps()} />
```

Returns a coherent vibrant-gradient set: random size (40-90 px), duration (5-11 s), starting offset (0-100), border width (1 or 2 px), direction (50/50), and a 2-color HSL pair 50-130° apart.

## Custom path / mask override

The trail's `offset-path` defaults to `rect(0 auto auto 0 round size)` — a rounded rectangle matching the parent's border-box. To trace a non-rectangular silhouette (e.g. a speech bubble with a tail), override `offset-path` and `mask` via inline style on the rendered DOM and feed an SVG `path()` or a custom mask url. The `.ecu-border-beam` and `.ecu-border-beam-trail` classes are the stable hooks to target.

See the host's `src/renderer/src/components/Modals/ImportFormatShowcase.tsx` for a worked example: a `ResizeObserver` measures the bubble, a path traces both the rounded rect and the comic-book tail, and an SVG-stroked mask clips the trail to a thin band along that outline.

## Reduced motion

Honours `@media (prefers-reduced-motion: reduce)` — the trail freezes in its current position rather than continuing to loop.
