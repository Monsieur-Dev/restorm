# Wordmark

Animated text component for branded titles, with a randomized loop of entry/exit effects.

## Overview

The `Wordmark` component renders a string with one of several animated text effects (per-character stagger entries, sweep gradients, scramble-then-resolve, 3D char flips). When `loop` is enabled, it cycles through the effects forever — each iteration re-rolls the variant, so consecutive cycles look different.

It's the typography counterpart of `Wallpaper` (background) and `Vignette` (frame): same vocabulary (`effect`, `'random'`, randomized parameters), same kind of "set it and forget it" decorative behavior.

All built-in effects are pure CSS or rAF — no `motion` runtime dependency.

## Installation

```typescript
import { Wordmark } from 'electron-core-ui/renderer'
```

## Component

### Wordmark

#### Props

```typescript
export type WordmarkEffectId =
  | 'text-animate'
  | 'dia-text-reveal'
  | 'hyper-text'
  | 'text-3d-flip'

export type WordmarkEffect = WordmarkEffectId | 'random'

export interface WordmarkProps {
  /** The text to render as the wordmark. */
  children: string
  /** Built-in effect applied to the text. Pass `'random'` to pick at mount
   *  (and per-iteration when `loop` is on). */
  effect?: WordmarkEffect
  /** When true, the wordmark cycles enter → display → exit → enter forever.
   *  A new random variant is picked at every iteration. */
  loop?: boolean
  /** Optional className appended to the root for custom styling. */
  className?: string
  /** Optional inline style overrides on the root. */
  style?: React.CSSProperties
  /** Optional test id for stable E2E selectors. */
  'data-testid'?: string
}
```

#### Built-in effects

| Effect id | Source | What it does |
|---|---|---|
| `text-animate` | Magic UI (MIT, ported, motion replaced by CSS keyframes + `@starting-style`) | Each segment (word or character) animates in with stagger using one of 10 variants: fade-in, blur-in, blur-in-up/down, slide-up/down/left/right, scale-up/down. Mirror "out" keyframes for the exit. |
| `dia-text-reveal` | Magic UI (MIT, ported, motion's `animate()` replaced by rAF + custom easing) | A horizontal gradient band sweeps across the text via `background-clip: text`, revealing it color-by-color before settling on the base color. |
| `hyper-text` | Magic UI (MIT, ported, motion replaced by rAF + React state) | Each character starts as a random glyph from a charset (uppercase, lowercase, hex, symbols, greek, …) and progressively settles on its target glyph from left to right. |
| `text-3d-flip` | Magic UI (MIT, ported, motion replaced by CSS keyframes with two-face cards) | Each character is a 3D card with two faces (same glyph on both); the card rotates 180° on enter / exit so the text stays visible throughout. Stagger origin is randomized (first / last / center / random). |

Each effect declares its own per-iteration timings (enter / display / exit). Using `loop`, the cycle runs roughly:

```
ENTER (effect-specific) → DISPLAY (~3s) → EXIT (effect-specific) → next iteration
```

#### Loop behavior

When `loop` is on, an internal state machine cycles through `enter → display → exit` and re-mounts the inner span on iteration change so animations replay fresh each cycle. New random props (variant, stagger, duration, colors, charset…) are rolled per iteration via the relevant `pickRandom...Props` helpers.

The chosen effect id for the *current* iteration is exposed on the root as `data-effect="..."`, and `data-phase="enter|display|exit"` reflects the current state — useful for tests or for layering additional CSS.

#### Usage

```tsx
import React from 'react'
import { Wordmark } from 'electron-core-ui/renderer'

export const Brand: React.FC = () => {
  return (
    <Wordmark effect="random" loop style={{ fontSize: 96, fontWeight: 800 }}>
      Restorm
    </Wordmark>
  )
}
```

##### Single shot (no loop)

```tsx
<Wordmark effect="text-animate">Hello</Wordmark>
```

##### Pinned to one effect

```tsx
<Wordmark effect="dia-text-reveal" loop>
  Brand
</Wordmark>
```

## Theming

The default text color comes from the parent's CSS — typically `var(--foreground)` if set on an ancestor. Effects that introduce their own colors (`dia-text-reveal` palette, `text-animate` doesn't recolor, etc.) accept overrides via the `pickRandom...Props` helpers if you want to compose a custom builder.

## Accessibility

Each effect renders the visible text segments as `aria-hidden`, with the full string exposed once via `aria-label` on the wrapper, so screen readers announce the word as a whole rather than each segment. `prefers-reduced-motion: reduce` disables the animations across all effects.

## Testing

If you pass a `data-testid`, target the root with `[data-testid="..."]`. Class hooks: `.ecu-wordmark` for the root, `.ecu-wordmark-effect-<id>` for each variant's container.
