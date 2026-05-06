# MagicCard

A soft, blurred radial spotlight that follows the cursor on hover — fades in when the pointer enters the parent, fades out when it leaves.

## Overview

`MagicCard` overlays its parent with an absolutely-positioned radial gradient whose center coordinates are CSS variables (`--ecu-magic-x`, `--ecu-magic-y`). A tiny pointer-listener installed on the parent updates those variables on every `pointermove`; the rendered position follows the cursor with no React re-render (zero state mutation, just direct DOM CSS-var writes). `mix-blend-mode: overlay` makes the spotlight adapt to dark and light backgrounds without per-theme tuning.

Adapted from [Magic UI](https://magicui.design/docs/components/magic-card) (MIT). The original used `motion` for the tracking; the port replaces that with the CSS-var direct write so it runs without a JS frame loop.

## Installation

```typescript
import { MagicCard } from 'electron-core-ui/renderer'
```

## Component

### MagicCard

#### Props

```typescript
export interface MagicCardProps {
  /** Size of the radial spotlight in pixels. */
  gradientSize?: number
  /** First color of the spotlight gradient. */
  gradientFrom?: string
  /** Second color of the spotlight gradient. */
  gradientTo?: string
  /** Blur radius applied to the spotlight, in pixels. */
  blur?: number
  /** Peak opacity of the spotlight when the cursor is over the card (0-1). */
  maxOpacity?: number
}
```

Defaults: `gradientSize: 280`, `gradientFrom: '#9E7AFF'`, `gradientTo: '#FE8BBB'`, `blur: 32`, `maxOpacity: 0.4`.

#### Usage

```tsx
import { MagicCard } from 'electron-core-ui/renderer'

export const InteractiveCard: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ position: 'relative', borderRadius: 12, padding: 24 }}>
    {children}
    <MagicCard gradientSize={320} maxOpacity={0.45} />
  </div>
)
```

The component installs its `pointermove` / `pointerleave` listeners on `parent.parentElement`, so the parent must render some content the user can hover over (the rest of the card). It cleans up on unmount.

## Random props

```typescript
import { pickRandomMagicCardProps } from 'electron-core-ui/renderer'

<MagicCard {...pickRandomMagicCardProps()} />
```

Returns a vibrant 2-color HSL pair (50-130° apart), a spotlight size 220-360 px, blur 20-48 px, and a peak opacity 0.3-0.5.

## Reduced motion

The only animated property is the 300 ms opacity fade-in/out — short enough to remain comfortable under `prefers-reduced-motion: reduce`. The cursor tracking itself is direct positional update, not motion-based.
