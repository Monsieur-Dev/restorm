# ShineBorder

A 2-3 colored radial gradient that sweeps slowly around the border at a cinematic pace.

## Overview

`ShineBorder` paints a large radial gradient onto its parent's border-box and animates `background-position` from one corner to the opposite and back. The interior of the parent is masked out with `mask-composite: exclude`, leaving only the border ring lit by the moving gradient. Compared to `BorderBeam`'s small comet, this one feels more ambient and continuous — better suited to long, steady states (welcome screens, hero cards, etc.).

Adapted from [Magic UI](https://magicui.design/docs/components/shine-border) (MIT) without behavioural changes.

## Installation

```typescript
import { ShineBorder } from 'electron-core-ui/renderer'
```

## Component

### ShineBorder

#### Props

```typescript
export interface ShineBorderProps {
  /** Border ring width in pixels. */
  borderWidth?: number
  /** Duration of one full shine cycle, in seconds. */
  duration?: number
  /** Single color or array of colors that compose the shine gradient. */
  shineColor?: string | string[]
}
```

Defaults: `borderWidth: 1`, `duration: 14`, `shineColor: '#000000'`.

When `shineColor` is an array, the colors are joined into a single `radial-gradient(transparent, transparent, c1, c2, …, transparent, transparent)`. The flanking `transparent` stops are what give the shine its falloff at both ends of the gradient axis.

#### Usage

```tsx
import { ShineBorder } from 'electron-core-ui/renderer'

export const HeroCard: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ position: 'relative', borderRadius: 12, padding: 24 }}>
    {children}
    <ShineBorder
      borderWidth={2}
      duration={12}
      shineColor={['#ff6b6b', '#feca57', '#48dbfb']}
    />
  </div>
)
```

## Random props

```typescript
import { pickRandomShineBorderProps } from 'electron-core-ui/renderer'

<ShineBorder {...pickRandomShineBorderProps()} />
```

Returns 2-3 vibrant HSL hues (saturation 75-90%, lightness 55-65%, hues 40-110° apart), a slow lap (8-18 s), and either a 1px or 2px border (with a 70/30 bias toward 1px).

## Reduced motion

Honours `@media (prefers-reduced-motion: reduce)` — the gradient freezes in place rather than sweeping.
