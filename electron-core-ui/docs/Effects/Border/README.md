# Effects / Border

Animated overlays designed to sit on top of any rectangular (or rounded-rectangular) container and decorate its border. Each effect is a self-contained React component that paints into a sibling element of its parent's content; none of them lay out their parent, so they can be dropped onto cards, vignettes, dialogs, custom shapes — anything with `position: relative` and a non-`hidden` overflow.

## Components

| Effect | Component | What it does |
|---|---|---|
| `border-beam` | [`BorderBeam`](BorderBeam/README.md) | A short colored gradient trail loops along the border. |
| `shine-border` | [`ShineBorder`](ShineBorder/README.md) | A radial gradient sweeps around the border via `mask-composite`. |
| `magic-card` | [`MagicCard`](MagicCard/README.md) | Soft colored glow that follows the cursor on hover. |
| `electric-border` | [`ElectricBorder`](ElectricBorder/README.md) | A wobbling lightning-like border with glow halo, driven by an SVG turbulence filter. |

The first three are sourced from [Magic UI](https://magicui.design) (MIT) and reimplemented with CSS keyframes (no `motion` runtime dependency). `ElectricBorder` is adapted from [Bálint Ferenczy's codepen](https://codepen.io/BalintFerenczy/pen/KwdoyEN) — its turbulence filter runs on the GPU, so it's also zero JS per frame. All four cost effectively zero JavaScript at runtime once mounted.

## Shared base class

All three components add `.ecu-border-effect` on their root — a single utility that:

- positions the effect overlay absolutely (`inset: 0`),
- inherits its parent's `border-radius` so the effect's bounds match the container's silhouette,
- never intercepts pointer events (`pointer-events: none`).

Consumers that need to ride a non-rectangular silhouette (e.g. a speech bubble with a comic-book tail) can keep `.ecu-border-effect` and override `inset`, `mask`, and `offset-path` via inline style — see the host's `ImportFormatShowcase` for a worked example.

## Public API

```typescript
import {
  BorderBeam,
  ShineBorder,
  MagicCard,
  ElectricBorder,
  pickRandomBorderBeamProps,
  pickRandomShineBorderProps,
  pickRandomMagicCardProps,
  pickRandomElectricBorderProps,
  pickRandomBorderEffect,
  borderEffectIds,
  type BorderEffectId,
  type BorderBeamProps,
  type ShineBorderProps,
  type MagicCardProps,
  type ElectricBorderProps
} from 'electron-core-ui/renderer'
```

`borderEffectIds` is the canonical list. `pickRandomBorderEffect()` mirrors the random pick used by the `Vignette` component when its `decoration="random"` is set.

## Random props pickers

Each effect ships its own `pickRandomXxxProps()` helper that returns a coherent vibrant-gradient set of inputs. They're useful when you want a stable "looks great by default but never the same twice" feel — that's what the Vignette uses internally.

## Example

```tsx
import { BorderBeam } from 'electron-core-ui/renderer'

export const Card: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ position: 'relative', borderRadius: 12, padding: 16 }}>
    {children}
    <BorderBeam size={60} duration={6} />
  </div>
)
```

## Reduced motion

All animated effects respect `@media (prefers-reduced-motion: reduce)` and pause their CSS animations under that media query. The `MagicCard` cursor-tracking continues to react to hover but its only animated property (the opacity fade-in) is a 300 ms transition — short enough to remain comfortable.
