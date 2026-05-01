# ThemeReveal

Circular reveal animation for theme switches, anchored at the user's cursor.

## Overview

`runThemeRevealTransition(apply, origin?)` runs a theme-changing callback inside a CSS view-transition that expands a circular `clip-path` mask from the supplied viewport-space anchor (typically the user's click coordinates). The new theme paints over the old one as the circle grows past the corner of the screen.

The helper is wired into `ThemeContext.setTheme` and the legacy `useTheme().setTheme` — both now accept an optional `origin` parameter and delegate to this utility when one is provided. Consumers that build their own theme-switching UIs can call the helper directly.

## API

```typescript
import { runThemeRevealTransition, type ThemeRevealOrigin } from 'electron-core-ui/renderer'

interface ThemeRevealOrigin {
  /** Anchor X in viewport pixels (e.g. event.clientX). */
  x: number
  /** Anchor Y in viewport pixels (e.g. event.clientY). */
  y: number
}

function runThemeRevealTransition(
  apply: () => void | Promise<void>,
  origin?: ThemeRevealOrigin
): Promise<void>
```

`apply` is the synchronous (or async) callback that mutates the DOM / CSS variables to switch the theme. Whatever it does must be visible-by-paint after it returns; the view-transition snapshots the page on entry and on exit, then animates between them.

`origin` is optional — when omitted, the reveal centers on the viewport.

The returned promise resolves once the transition has finished (or immediately when no animation runs). It never rejects; if the underlying view transition is interrupted the apply callback's effects still land.

## Behavior

- **Chromium-based hosts** (Electron, Chrome, Edge): runs `document.startViewTransition(apply)` and animates the new-root pseudo-element with a 600ms `clip-path: circle(...)` from radius 0 at the anchor to 150% (corner-covering).
- **Other browsers** without `startViewTransition`: runs `apply()` directly — no animation.
- **`prefers-reduced-motion: reduce`**: same as above — `apply()` runs without animation.

## Wiring into a click handler

```tsx
import React from 'react'
import { useThemeContext } from 'electron-core-ui/renderer'

export const ThemeToggle: React.FC = () => {
  const { setTheme, currentThemeId } = useThemeContext()
  const next = currentThemeId === 'dark' ? 'light' : 'dark'

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>): void => {
    void setTheme(next, { x: event.clientX, y: event.clientY })
  }

  return (
    <button type="button" onClick={handleClick}>
      Toggle theme
    </button>
  )
}
```

For keyboard activation (where `clientX`/`clientY` are 0), `ThemeCarousel` falls back to the bounding-rect center of the activated tile — replicate that pattern in custom triggers if you want a sensible reveal anchor for keyboard users.

## CSS

The keyframes (`@keyframes ecu-theme-reveal` + `::view-transition-new(root)` rule) ship in `themeReveal.css`, imported transitively by the helper module — no separate CSS import is required from consumers as long as they import the helper from `electron-core-ui/renderer`.

The reveal reads its anchor from `--ecu-theme-reveal-x` / `--ecu-theme-reveal-y` CSS variables that the helper writes onto `document.documentElement` right before starting the transition. Override these on the root if you want to retarget the anchor without going through `runThemeRevealTransition` (rare).

## Testing

The transition runs entirely in the browser's compositor and finishes within 600ms. End-to-end tests that pick a theme via `ThemeCarousel` should still poll for the post-transition state attribute (`data-selected-theme-id` on the carousel root) — the existing 5s polling window in `restorm`'s e2e steps is well within the transition duration.

When asserting the absence of animation (e.g. tests running with `prefers-reduced-motion`), call `runThemeRevealTransition` directly and check that `apply` ran synchronously by the time the returned promise resolves.
