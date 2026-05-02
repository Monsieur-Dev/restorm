# RecentFilesVignette

Frosted-glass panel listing the user's favorites and recent files, ready to drop into a welcome / empty-state surface.

## Overview

`RecentFilesVignette` is a self-contained, theme-aware panel that:

- Pulls data from `useFileService()` (`recentFiles`, `favorites`, `toggleFavorite`).
- Renders a Favorites section first, then a Recent Files section. Each section disappears when its list is empty; the whole panel returns `null` when both are empty (so the consumer's empty-state hint shows through cleanly).
- Wraps the lists in a `Vignette` (`'random'` decoration by default) so the surface matches the rest of the welcome experience.
- Animates additions / removals via the reusable `.ecu-vignette-row` primitive — items expand into place, fade in, and play the inverse cascade on remove.
- Forwards file open requests through a single `onOpenFile(path)` callback so the consumer keeps full control of the open routine (preload IPC, navigation history, etc.).
- Confirms favorite removal via `window.confirm` by default, swappable for a custom `confirmRemoveFavorite` hook (e.g. an in-app modal).

## Installation

```typescript
import { RecentFilesVignette } from 'electron-core-ui/renderer'
```

## Component

### RecentFilesVignette

#### Props

```typescript
import type { VignetteDecoration } from 'electron-core-ui/renderer'

export interface RecentFilesVignetteProps {
  /**
   * Called when the user clicks (or activates with Enter / Space) a
   * file row. The component itself only knows the file's path —
   * dispatching to the right open routine is the consumer's job.
   */
  onOpenFile: (path: string) => void
  /**
   * Optional confirm hook called before removing a favorite.
   * Defaults to a synchronous `window.confirm` with a localized
   * message. Return `true` to proceed, `false` to cancel.
   */
  confirmRemoveFavorite?: (fileName: string) => boolean | Promise<boolean>
  /** Vignette decoration applied to the frame. Defaults to `'random'`. */
  decoration?: VignetteDecoration
  /** Optional className appended to the Vignette root for layout overrides. */
  className?: string
  /** Optional inline style overrides on the Vignette root. */
  style?: React.CSSProperties
  /** Optional test id applied to the Vignette root. Defaults to `recent-files-vignette`. */
  'data-testid'?: string
}
```

#### Usage

Drop it inside any positioned ancestor — the panel is just a `Vignette`, so it doesn't anchor itself anywhere. The example below mirrors the welcome layout used by Restorm: panel pinned to the bottom-left corner, Wallpaper behind, hero / actions stacked centrally.

```tsx
import React from 'react'
import { RecentFilesVignette, Wallpaper } from 'electron-core-ui/renderer'

export const Welcome: React.FC = () => {
  const handleOpen = (path: string): void => {
    void window.api.file.openPath(path)
  }

  return (
    <main style={{ position: 'relative', height: '100%' }}>
      <Wallpaper pattern="random" />
      <RecentFilesVignette
        onOpenFile={handleOpen}
        style={{ position: 'absolute', bottom: 32, left: 32 }}
      />
    </main>
  )
}
```

##### With a custom confirm modal

```tsx
<RecentFilesVignette
  onOpenFile={openPath}
  confirmRemoveFavorite={(fileName) => myConfirmModal.ask(`Remove "${fileName}" from favorites?`)}
/>
```

The callback may return either a boolean or a `Promise<boolean>`; the panel awaits whatever you return.

##### Pinning the decoration

```tsx
<RecentFilesVignette onOpenFile={openPath} decoration="border-beam" />
```

#### Empty state

When both `recentFiles` and `favorites` are empty (e.g. brand-new installs), `RecentFilesVignette` returns `null`. Render your own hint / illustration in the same surface to fill the gap:

```tsx
{hasContent
  ? <RecentFilesVignette onOpenFile={openPath} />
  : <p>Open a file or create a new one to get started.</p>}
```

## Behavior

- **Animations** — handled by the `Vignette` row primitive: `0fr → 1fr` grid expand on enter (0.7s), opacity 0 → 1 fade on the inner content (0.55s), inverse cascade on exit.
- **Keyboard** — each row is a `role="button"` that fires `onOpenFile` on Enter / Space.
- **Star toggle** — clicking the star never opens the file (handler stops propagation). Removing a favorite always confirms; adding never does.
- **Theme** — section title border uses `--panel-border`; row hover uses `--list-hoverBackground`; favorite icon uses `#f5c518` (gold). Override on the root if you need a different palette.

## i18n

The panel reads from the ECUI `recentFilesVignette` namespace:

| Key | English | Used for |
|---|---|---|
| `recentFilesVignette.favorites` | "Favorites" | Section heading |
| `recentFilesVignette.recentFiles` | "Recent Files" | Section heading |
| `recentFilesVignette.addToFavorites` | "Add to favorites" | Star button title / aria-label when not favorited |
| `recentFilesVignette.removeFromFavorites` | "Remove from favorites" | Star button title / aria-label when favorited |
| `recentFilesVignette.confirmRemoveFavorite` | "Are you sure you want to remove \"{{fileName}}\" from favorites?" | Default confirm message |
| `recentFilesVignette.favoritesLandmarkLabel` | "Favorites list" | `<section aria-label>` |
| `recentFilesVignette.recentsLandmarkLabel` | "Recent files list" | `<section aria-label>` |

French translations ship out of the box. Override or add languages by extending your i18next resource bundles.

## Testing

The panel exposes stable test ids:

- Root — `data-testid={dataTestId ?? 'recent-files-vignette'}` (the `Vignette` element).
- Star toggle on a recent — `[data-testid="recent-files-vignette-toggle-favorite-button"]`.
- Star toggle on a favorite — `[data-testid="recent-files-vignette-remove-favorite-button"]`.

Class hooks: `.ecu-recent-files-vignette` (root), `.ecu-recent-files-vignette-section`, `.ecu-recent-files-vignette-list`, `.ecu-recent-files-vignette-item`. Each row's favorite star is rendered by `Toggle` with `appearance="star"` (Lottie-backed, see the Toggle doc) wrapped in `.ecu-recent-files-vignette-toggle-wrap` to swallow the row click. Modifier classes pinned via `actionClassName`: `.ecu-recent-files-vignette-star--active` (always visible, full-color) and `.ecu-recent-files-vignette-star--reveal-on-hover` (hidden by default, grey star fades in when the row is hovered).
