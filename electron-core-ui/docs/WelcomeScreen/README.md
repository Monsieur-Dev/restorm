# WelcomeScreen

Empty-state landing surface for an Electron workbench: animated wallpaper, looped brand wordmark, action stack, and frosted favorites/recents panel.

## Overview

`WelcomeScreen` composes the four decorative ECUI primitives (`Wallpaper`, `Wordmark`, `FilesPanel` over `Vignette`) into a single drop-in welcome experience. The consumer supplies:

- The brand `name` to render as the animated wordmark in the header.
- Action buttons via `children` (typically two or three `RainbowButton`s).
- An `onOpenFile(path)` callback dispatched when the user clicks a row in the files panel.
- An optional `emptyStateHint` rendered below the actions when both favorites and recents are empty.

Everything else (random pattern selection, animated wordmark cycle, frosted panel, responsive reflow at narrow viewports) is handled internally.

## Installation

```typescript
import { WelcomeScreen } from 'electron-core-ui/renderer'
```

## Component

### WelcomeScreen

#### Props

```typescript
import type { VignetteDecoration, WallpaperPattern, WordmarkEffect } from 'electron-core-ui/renderer'

export interface WelcomeScreenProps {
  /** Brand name rendered as the animated wordmark + visually-hidden h1. */
  name: string
  /** Action buttons rendered in a centered, vertically stacked column. */
  children?: React.ReactNode
  /** Called when the user activates a file row inside the favorites / recents panel. */
  onOpenFile: (path: string) => void
  /** Optional hint shown below actions when favorites + recents are both empty. */
  emptyStateHint?: React.ReactNode
  /** Optional confirm hook for removing a favorite — passed through to FilesPanel. */
  confirmRemoveFavorite?: (fileName: string) => boolean | Promise<boolean>
  /** Wallpaper pattern. Defaults to `'random'`. */
  wallpaperPattern?: WallpaperPattern
  /** Wordmark animation effect. Defaults to `'random'`. */
  wordmarkEffect?: WordmarkEffect
  /** FilesPanel decoration. Defaults to `'random'`. */
  filesPanelDecoration?: VignetteDecoration
  /** Override `<main>` aria-label. Defaults to the `welcomeScreen.landmarkLabel` translation. */
  ariaLabel?: string
  /** Optional className appended to the root for layout overrides. */
  className?: string
  /** Optional inline style overrides on the root. */
  style?: React.CSSProperties
  /** Optional test id applied to the root. Defaults to `welcome-screen`. */
  'data-testid'?: string
}
```

#### Layout

```
┌────────────────────────────────────────────────┐
│ ┌─────────[Wallpaper random pattern]─────────┐ │
│ │                                            │ │
│ │                              ┌───────────┐ │ │
│ │                              │ Wordmark  │ │ │
│ │                              │ ─────────│ │ │
│ │                                            │ │
│ │                                            │ │
│ │           ┌──────────────┐                 │ │
│ │           │   children   │                 │ │
│ │           │ (your CTAs)  │                 │ │
│ │           └──────────────┘                 │ │
│ │             empty hint                     │ │
│ │                                            │ │
│ │  ┌────────┐                                │ │
│ │  │ Files- │                                │ │
│ │  │ Panel  │                                │ │
│ │  └────────┘                                │ │
│ └────────────────────────────────────────────┘ │
└────────────────────────────────────────────────┘
```

Below ~720px the layout reflows top-to-bottom (header → actions → files panel) so nothing overlaps.

#### Usage

```tsx
import React from 'react'
import { WelcomeScreen, RainbowButton } from 'electron-core-ui/renderer'

export const Welcome: React.FC<{ onNew: () => void; onOpen: () => void }> = ({ onNew, onOpen }) => {
  const handleOpenFile = (path: string): void => {
    void window.api.file.openPath(path)
  }

  return (
    <WelcomeScreen
      name="Acme"
      onOpenFile={handleOpenFile}
      emptyStateHint="Open a file or create a new one to get started"
    >
      <RainbowButton size="xl" onClick={onNew} aria-label="Create a new collection">
        New
      </RainbowButton>
      <RainbowButton size="xl" onClick={onOpen} aria-label="Open a collection from disk">
        Open
      </RainbowButton>
    </WelcomeScreen>
  )
}
```

##### Custom confirm modal for favorite removal

```tsx
<WelcomeScreen
  name="Acme"
  onOpenFile={openPath}
  confirmRemoveFavorite={(fileName) => myConfirmModal.ask(`Remove "${fileName}" from favorites?`)}
>
  …
</WelcomeScreen>
```

##### Pinning a specific pattern / effect / decoration

```tsx
<WelcomeScreen
  name="Acme"
  onOpenFile={openPath}
  wallpaperPattern="neuro-noise"
  wordmarkEffect="text-3d-flip"
  filesPanelDecoration="border-beam"
>
  …
</WelcomeScreen>
```

Pass any value of `WallpaperPattern`, `WordmarkEffect`, or `VignetteDecoration` (or `'random'`).

## Behavior

- **Data** — pulls favorites + recents through `useFileService()`. The action stack and hint render unconditionally; the files panel only renders when at least one list is non-empty (it returns `null` otherwise so the consumer's hint surface stays clean).
- **Animations** — wallpaper, wordmark loop, and files-panel row cascade all respect `prefers-reduced-motion: reduce`.
- **Accessibility** — `<main role="main" aria-label>`, `<h1>` with the brand name (visually hidden, since the wordmark animation is decorative), `<header>` and `<section>` landmarks inside, all action elements expose names through `aria-label` from the consumer (forward `aria-*` props on your `<RainbowButton>` / `<button>` children).
- **Responsive** — layout reflows at 720px and 480px breakpoints; both header and files panel switch from absolutely-positioned to static.

## i18n

Single key: `welcomeScreen.landmarkLabel` (default English: "Welcome", French: "Accueil"), used as the `<main>` aria-label unless overridden via the `ariaLabel` prop.

The files panel underneath uses the `filesPanel.*` namespace — see the [FilesPanel docs](../FilesPanel/README.md).

The action buttons and empty-state hint are consumer-rendered, so any localization happens in the consumer's i18n bundle.

## Testing

The root exposes `data-testid={dataTestId ?? 'welcome-screen'}`. Class hooks: `.ecu-welcome-screen` (root), `.ecu-welcome-screen-header`, `.ecu-welcome-screen-actions`, `.ecu-welcome-screen-files-panel`. The files panel uses its own `.ecu-files-panel-*` hooks (see FilesPanel docs).
