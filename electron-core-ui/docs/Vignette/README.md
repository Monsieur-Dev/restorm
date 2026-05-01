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
export type VignetteDecorationId = 'border-beam' | 'shine-border' | 'magic-card'
export type VignetteDecoration = VignetteDecorationId | 'random'

export interface VignetteProps {
  /** Built-in decoration applied to the frame. Pass `'random'` to pick at mount. */
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

| Decoration id | Source | What it does |
|---|---|---|
| `border-beam` | Magic UI (MIT, ported, motion replaced by CSS `offset-path` keyframes) | A short colored gradient trail loops along the border with random size, speed, direction, color pair and starting offset. |
| `shine-border` | Magic UI (MIT, ported) | A radial gradient sweeps around the border via `mask-composite`; 2-3 random vibrant colors, slow cinematic pace. |
| `magic-card` | Magic UI (MIT, ported, motion replaced by direct DOM CSS-var mutation) | Soft colored glow that follows the cursor on hover (mix-blend-mode: overlay so it adapts to dark/light themes); zero rerender, ref-based pointer tracking. |

The chosen decoration id is exposed on the root as `data-decoration="..."`. With `decoration="random"` the choice is stable for the vignette's lifetime.

`vignetteDecorationIds` exports the full list and `pickRandomVignetteDecoration()` mirrors the random selection logic if consumers want to build their own pickers.

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

If you pass a `data-testid`, target the root with `[data-testid="..."]`. The root also exposes `data-decoration="<resolved id>"` once a decoration has been picked. Class hooks: `.ecu-vignette` for the frame, `.ecu-vignette-content` for the content wrapper, `.ecu-vignette-decoration-<id>` for each decoration variant.
