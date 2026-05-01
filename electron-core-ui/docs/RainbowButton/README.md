# RainbowButton

Decorative button with an animated rainbow gradient border and a soft glow underneath, revealed on hover.

## Overview

The `RainbowButton` component is a CTA-style button: solid dark surface (always), animated rainbow border that's pinned to the bottom edge and amplified by a blurred glow underneath. The animation is paused at rest and runs only on hover, so the button is calm in idle and lights up when interacted with.

Adapted from Magic UI's "Rainbow Button" (MIT) — the original Tailwind utility classes were translated to plain CSS, the Radix `Slot` and `class-variance-authority` dependencies were dropped, and the ever-running animation was changed to hover-only.

## Installation

```typescript
import { RainbowButton } from 'electron-core-ui/renderer'
```

## Component

### RainbowButton

#### Props

```typescript
export type RainbowButtonSize = 'sm' | 'default' | 'lg' | 'xl'

export interface RainbowButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: RainbowButtonSize
}
```

All standard `<button>` props are forwarded — `onClick`, `disabled`, `type`, `aria-*`, `data-testid`, etc.

#### Sizes

| Size | Font / padding | Use when |
|---|---|---|
| `sm` | 13px / 8×16 | Inline secondary actions. |
| `default` | 14px / 10×20 | Standard CTA. |
| `lg` | 16px / 14×28 | Section CTA. |
| `xl` | 20px / 20×40 | Hero CTA on welcome / landing surfaces. |

#### Animation

- At rest: animation paused, `::before` glow is `opacity: 0` (button is just a solid dark capsule with a thin transparent border).
- On hover or `:focus-visible`: the rainbow gradient animation resumes (`background-position` shift), the bottom-glow `::before` fades to `opacity: 1`, the button lifts 1px and brightens by 5%.
- On active: button drops back, brightness 95%.
- `:focus-visible` also paints a 2px outline using `--focusBorder` (with a `#0a84ff` fallback) at 3px offset, so keyboard users see a stable focus ring on top of the lit-up gradient.
- `prefers-reduced-motion: reduce`: animation disabled in both states (focus outline still applies).

The colors are exposed as CSS custom properties (`--ecu-rainbow-c1` … `--ecu-rainbow-c5`) and can be overridden on the root or any ancestor:

```css
.brand-cta {
  --ecu-rainbow-c1: #ff8a00;
  --ecu-rainbow-c2: #e52e71;
  --ecu-rainbow-c3: #ffd166;
  --ecu-rainbow-c4: #06d6a0;
  --ecu-rainbow-c5: #118ab2;
}
```

The button surface is always dark (`#121213`) regardless of the active app theme — that's the variant from the magicui design we picked for visual consistency.

#### Usage

```tsx
import React from 'react'
import { RainbowButton } from 'electron-core-ui/renderer'

export const HeroCTA: React.FC<{ onStart: () => void }> = ({ onStart }) => {
  return (
    <RainbowButton size="xl" onClick={onStart}>
      Get started
    </RainbowButton>
  )
}
```

##### Stacked CTAs

```tsx
<div style={{ display: 'flex', flexDirection: 'column', gap: 24, width: 280 }}>
  <RainbowButton size="xl" onClick={onNew}>New</RainbowButton>
  <RainbowButton size="xl" onClick={onOpen}>Open</RainbowButton>
</div>
```

The `align-items: stretch` on the parent keeps both buttons the same width regardless of label length.

## Testing

The class hook is `.ecu-rainbow-button` plus `.ecu-rainbow-button--<size>` for the size variant. Pass `data-testid` like any standard `<button>`.
