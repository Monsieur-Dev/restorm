# Vignette

A glassmorphic frame with an animated decoration around its edge — pendant of `Wallpaper` for content containers.

## Overview

The `Vignette` component wraps arbitrary content in a frosted-glass card and overlays one of several animated edge decorations (light beam, shimmering border, cursor-tracked spotlight). It is the "container" counterpart to `Wallpaper`'s "background" — both share the same design vocabulary (built-in identifiers, `'random'` mount-time pick, randomized parameters).

The frame itself provides:

- A subtle frosted-glass background tint via `backdrop-filter: blur() saturate()` (looks best on top of a `Wallpaper`).
- A 1px hairline border for the glass-edge effect.
- A soft drop shadow + inset highlight to lift it off the page.
- Rounded corners (12px default).

It also exposes a reusable enter/exit animation primitive — `.ecu-vignette-row` / `.ecu-vignette-row-inner` — so any element rendered inside can be animated in/out with the same staggered "row expands → content fades" pattern (see [Reusable row animation](#reusable-row-animation)).

## Installation

```typescript
import { Vignette } from 'electron-core-ui/renderer'
```

## Component

### Vignette

#### Props

```typescript
import type { BorderEffectId } from 'electron-core-ui/renderer'

export type VignetteDecoration = BorderEffectId | 'random'

export interface VignetteProps {
  /** Border effect applied to the frame. Pass `'random'` to pick at mount. */
  decoration?: VignetteDecoration
  /** Content rendered inside the frame. */
  children?: React.ReactNode
  /** Optional className appended to the root for custom styling. */
  className?: string
  /** Optional inline style overrides on the root. */
  style?: React.CSSProperties
  /** Optional test id for stable E2E selectors. */
  'data-testid'?: string
}
```

#### Built-in decorations

The decoration enum is the shared `BorderEffectId` exposed by [`Effects/Border`](../Effects/Border/README.md) — see those per-effect docs for visual reference and props:

- [`border-beam`](../Effects/Border/BorderBeam/README.md) — colored gradient trail looping along the border.
- [`shine-border`](../Effects/Border/ShineBorder/README.md) — radial gradient sweeping around the border at a cinematic pace.
- [`magic-card`](../Effects/Border/MagicCard/README.md) — cursor-tracked spotlight that fades in on hover.
- [`electric-border`](../Effects/Border/ElectricBorder/README.md) — turbulence-displaced wobbling border with glow halo.

The chosen id is exposed on the Vignette root as `data-decoration="..."`. With `decoration="random"` the choice is stable for the vignette's lifetime; the random-pick lives in `pickRandomBorderEffect()` from `electron-core-ui/renderer`.

#### Reusable row animation

The same primitive used to animate the file-list rows inside a Vignette is exposed for any consumer:

```tsx
<Vignette decoration="border-beam">
  <div className="ecu-vignette-row" data-phase={phase}>
    <div className="ecu-vignette-row-inner">
      {/* content */}
    </div>
  </div>
</Vignette>
```

On enter, the row expands its grid track from `0fr` to `1fr` over 0.7s (so the surrounding layout reflows smoothly) and the inner content then fades `opacity: 0 → 1` over the following 0.55s. Toggling `data-phase="exit"` plays the inverse — content fades out first (0–0.55s), then the row collapses back to `0fr` (0.55–1.25s). Both transitions use `@starting-style` to declare the "before" state, so a fresh mount runs the enter pattern automatically.

#### Usage

```tsx
import React from 'react'
import { Wallpaper, Vignette } from 'electron-core-ui/renderer'

export const Panel: React.FC = () => {
  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <Wallpaper pattern="random" />
      <Vignette decoration="random" style={{ padding: 24, maxWidth: 480 }}>
        <h3>Welcome</h3>
        <p>This is a frosted glass card with an animated edge.</p>
      </Vignette>
    </div>
  )
}
```

## Theming

The frame's tint and border are driven by the `--foreground` and `--editor-background` CSS variables (the standard ECUI/VS Code theme tokens). Override them on a parent class to retint the frame globally:

```css
.brand-section {
  --foreground: #112;
}
```

## Testing

If you pass a `data-testid`, target the root with `[data-testid="..."]`. The root also exposes `data-decoration="<resolved id>"` once a decoration has been picked. Class hooks: `.ecu-vignette` for the frame, `.ecu-vignette-content` for the content wrapper, plus one of the border-effect classes (`.ecu-border-beam`, `.ecu-shine-border`, `.ecu-magic-card`, `.ecu-electric-border`) on the overlay element — see [`Effects/Border`](../Effects/Border/README.md) for details.
