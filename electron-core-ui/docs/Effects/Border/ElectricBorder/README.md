# ElectricBorder

A wobbling, lightning-like border with a soft glow halo, two highlight overlays, and an outer ambient ring. Driven by an SVG turbulence filter that displaces the rendered border in a continuously animated noise field.

## Overview

`ElectricBorder` overlays its parent with seven layered elements:

1. an ambient gradient ring (painted on the root via `background`),
2. a heavily-blurred halo behind everything (`z-index: -1`),
3. two `mix-blend-mode: overlay` highlight gradients (one bright, one dim),
4. a soft-glow blurred ring (1px blur),
5. a bright-glow blurred ring (4px blur),
6. and the main wobbly border, which carries `filter: url(#ecu-electric-border-displace-<id>)`.

The SVG filter is rendered inline as part of the component (in a `width: 0; height: 0` host) so each instance gets its own filter id (via React's `useId()`); that prevents the animated `<feOffset>`s from sharing state when several ElectricBorders coexist on the same page. The `<feOffset>` `dx` / `dy` are driven by a `requestAnimationFrame` loop (eight pairs tracing ellipses at constant angular speed) — not SMIL `<animate>`, which had a multi-second warm-up latency in Chromium that left the wobble visibly frozen at first paint.

Adapted from Bálint Ferenczy's [Animated Electric Border CSS Card](https://codepen.io/BalintFerenczy/pen/KwdoyEN) (MIT-style demo). The original is a single static card; this port:

- moves the filter to per-instance ids,
- exposes color, border-width, and animation-duration props,
- drops the original card-layout concerns — this is an overlay effect, not a card layout.

## Installation

```typescript
import { ElectricBorder } from 'electron-core-ui/renderer'
```

## Component

### ElectricBorder

#### Props

```typescript
export interface ElectricBorderProps {
  /** Base color of the wobbling border. Drives the glow + halo via OKLCH. */
  color?: string
  /** Border-ring width in pixels. */
  borderWidth?: number
  /** Duration of one full noise cycle, in seconds. */
  duration?: number
  /** Border radius for the effect; defaults to `inherit` from the parent. */
  borderRadius?: string
}
```

Defaults: `color: '#dd8448'`, `borderWidth: 2`, `duration: 6`, `borderRadius: undefined` (inherits from the parent's `border-radius`).

The `color` prop drives the entire palette: the glow ring uses `oklch(from <color> l c h)` for a light-shifted version, and the ambient gradient uses `oklch(from <color> 0.3 calc(c / 2) h / 0.4)` for a desaturated darker tint. So picking any saturated hue gives a coherent neon-electric look.

#### Usage

```tsx
import { ElectricBorder } from 'electron-core-ui/renderer'

export const HighlightedCard: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ position: 'relative', borderRadius: 24, padding: 32 }}>
    {children}
    <ElectricBorder color="#5cf9d6" borderWidth={2} duration={6} />
  </div>
)
```

The parent must establish a containing block (`position: relative`) and ideally have a non-zero `border-radius` for the wobbly border to look right.

## Random props

```typescript
import { pickRandomElectricBorderProps } from 'electron-core-ui/renderer'

<ElectricBorder {...pickRandomElectricBorderProps()} />
```

Returns a curated palette pick (orange / amber / cyan / lime / magenta / blue / red), a noise-cycle duration of 5-9 s, and a 70/30 bias toward 2px borders over 3px.

## Browser compatibility

The component leans on:

- SVG `<feTurbulence>` + `<feDisplacementMap>` (universal in modern browsers).
- CSS Relative Color Syntax (`oklch(from var(--c) l c h)`) for the glow + halo derivations. This requires Chrome 119+ / Safari 16.4+ / Firefox 128+. In Electron 41 (Chromium 134) it's supported out of the box.
- `mix-blend-mode: overlay`, `filter: blur()`, and CSS variables — all well-supported.

## Reduced motion

Honours `@media (prefers-reduced-motion: reduce)` — the SVG filter is dropped under that media query, leaving a static (non-wobbling) border with the glow rings + halo intact. The component's `requestAnimationFrame` loop continues running and writing `dx` / `dy` to the `<feOffset>` elements, but those values are no longer consumed because the filter is detached from the main ring.

## Performance

The turbulence-filter calculation is GPU-bound but expensive enough that you generally don't want more than ~3-4 ElectricBorders animating simultaneously on screen. The component itself is cheap — it's the filter sample that costs.
