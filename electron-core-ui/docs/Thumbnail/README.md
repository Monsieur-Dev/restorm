# Thumbnail

A compact preview of an **image or video** that opens large inside the shared ECUI `Modal` on click, and can be copied to the clipboard from a right-click menu.

## Overview

`Thumbnail` renders a small, bordered preview of a piece of media. It is intentionally host-agnostic:

- It takes the media as a ready-to-render `src` (a `data:` URI, a `file://` path, a blob URL, or an http(s) URL) — the host owns the encoding.
- It ships **no baked-in copy**. The host injects any labels via the optional `labels` prop; when omitted the affordances fall back to language-neutral glyphs.

Interactions:

- **Click** → opens the media large inside the shared ECUI [`Modal`](../Modal/README.md) (`size="full"`, non-scoped), so it gets the consistent ECUI modal chrome — border, header, close button — plus the Modal's own Escape / close handling. The media is centered in the body and scrolls there when larger than the body. Dismiss with the modal close button or **Escape**.
- **Right-click** (on both the thumbnail and the enlarged view) → a context menu with **Copy**, which puts the media on the system clipboard.

## Installation

```typescript
import { Thumbnail } from 'electron-core-ui/renderer'
```

## Component

### Thumbnail

#### Props

```typescript
export type ThumbnailMediaKind = 'image' | 'video'

export interface ThumbnailMedia {
  /** `image` for a still, `video` for a clip. Drives <img> vs <video>. */
  kind: ThumbnailMediaKind
  /** The media source — anything assignable to an <img>/<video> `src`
   * (data: URI, file:// path, blob URL, http URL). */
  src: string
  /** MIME type, e.g. `image/png`. Used when copying. */
  mimeType?: string
}

export interface ThumbnailLabels {
  /** Right-click menu entry that copies the media to the clipboard. */
  copy: string
  /** Accessible label / tooltip on the enlarged view's close control. */
  close: string
}

export interface ThumbnailProps {
  /** The image / video to display. */
  media: ThumbnailMedia
  /** Localized copy injected by the host (ECUI ships none). Optional. */
  labels?: ThumbnailLabels
  /** Optional className appended to the thumbnail root. */
  className?: string
  /** Optional inline style overrides on the thumbnail root. */
  style?: React.CSSProperties
  /** Called after the media is copied to the clipboard. */
  onCopied?: () => void
  /** Called when copying fails (clipboard denied, unsupported type, …). */
  onCopyError?: (error: unknown) => void
  /** Optional test id applied to the thumbnail root. */
  'data-testid'?: string
}
```

#### Usage

```tsx
import React from 'react'
import { Thumbnail } from 'electron-core-ui/renderer'

export const Example: React.FC<{ pngBase64: string }> = ({ pngBase64 }) => (
  <Thumbnail
    media={{ kind: 'image', src: `data:image/png;base64,${pngBase64}`, mimeType: 'image/png' }}
    labels={{ copy: 'Copy', close: 'Close' }}
    onCopied={() => { /* host toast */ }}
  />
)
```

## Clipboard behaviour

- **Images** are copied through the async Clipboard API as an `image/png` `ClipboardItem`. The `src` is fetched into a `Blob` first (works for `data:`, `blob:`, `file://`, and http sources); a non-PNG image blob is re-encoded to PNG through a `<canvas>` so the paste target gets a universally supported type.
- **Videos** have no cross-platform clipboard image representation, so the source **locator** (the file path or URL) is copied as text instead — the most useful fallback.

The `onCopied` / `onCopyError` callbacks let the host surface a toast either way.

## Theming

The thumbnail border pulls from the standard ECUI theme tokens (`--panel-border`, `--focusBorder`). The enlarged view inherits the shared ECUI `Modal` chrome, so it matches every other modal in the app on both themes.

## Testing

Pass `data-testid` to target the root (`[data-testid="..."]`, default `thumbnail`). Derived hooks:

- `${testId}` — the clickable thumbnail button (also carries `data-kind="image|video"`).
- `${testId}-menu` — the right-click context menu; `thumbnail-copy` — its Copy item.
- `${testId}-enlarged` — the ECUI `Modal` showing the enlarged media; `${testId}-enlarged-close` — the Modal's close button; `${testId}-enlarged-menu` — the enlarged view's right-click menu (with `thumbnail-enlarged-copy`).

Class hooks: `.ecu-thumbnail` (root), `.ecu-thumbnail-media`, `.ecu-thumbnail-enlarged-body`, `.ecu-thumbnail-enlarged-media`.
