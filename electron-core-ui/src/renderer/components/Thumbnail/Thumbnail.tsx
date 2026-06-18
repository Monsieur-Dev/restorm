import React, { useCallback, useState } from 'react'
import { ContextMenu, type ContextMenuItem } from '../ContextMenu/ContextMenu'
import { Modal } from '../Modal'
import './thumbnail.css'

/** The media a {@link Thumbnail} renders — an image or a video. */
export type ThumbnailMediaKind = 'image' | 'video'

export interface ThumbnailMedia {
  /** `image` for a still, `video` for a clip. Drives <img> vs <video>. */
  kind: ThumbnailMediaKind
  /**
   * The media source. Anything assignable to an `<img>`/`<video>` `src`:
   * a `data:` URI (e.g. `data:image/png;base64,…`), a `file://` path, a
   * blob URL, or an http(s) URL. The host owns the encoding; the component
   * just renders + copies it.
   */
  src: string
  /** MIME type, e.g. `image/png` or `video/webm`. Used when copying. */
  mimeType?: string
}

export interface ThumbnailLabels {
  /** Right-click menu entry that copies the media to the clipboard. */
  copy: string
  /** Accessible label / tooltip on the close control of the enlarged view. */
  close: string
}

export interface ThumbnailProps {
  /** The image / video to display. */
  media: ThumbnailMedia
  /**
   * Title shown in the enlarged view's modal header (the host builds it, e.g.
   * an icon + a localized caption — ECUI ships no copy). Omit for no title.
   */
  title?: React.ReactNode
  /**
   * Localized copy injected by the host — ECUI ships no baked-in strings.
   * Optional: when omitted the right-click "Copy" menu and the enlarged
   * view's close affordance fall back to bare, language-neutral glyphs.
   */
  labels?: ThumbnailLabels
  /** Optional className appended to the thumbnail root. */
  className?: string
  /** Optional inline style overrides on the thumbnail root. */
  style?: React.CSSProperties
  /**
   * Called after the media is copied to the clipboard (from either the
   * thumbnail or the enlarged view). Lets the host surface a toast.
   */
  onCopied?: () => void
  /**
   * Called when copying to the clipboard fails (clipboard denied, an
   * unsupported media type, …). Lets the host surface an error toast.
   */
  onCopyError?: (error: unknown) => void
  /** Optional test id applied to the thumbnail root. */
  'data-testid'?: string
}

/**
 * Copy a media source to the system clipboard. Images go through the async
 * Clipboard API as an `image/*` `ClipboardItem`; the source is fetched into a
 * Blob first (works for `data:`, `blob:`, `file://` and http URLs). Videos
 * have no cross-platform clipboard image representation, so the source URL /
 * path is copied as text instead — the most useful fallback for a file path.
 */
async function copyMediaToClipboard(media: ThumbnailMedia): Promise<void> {
  if (media.kind === 'video') {
    // No standard clipboard slot for video bytes — copy the locator (path /
    // URL) as text so the user can at least paste where the clip lives.
    const text = media.src.startsWith('file://') ? media.src.slice('file://'.length) : media.src
    await navigator.clipboard.writeText(text)
    return
  }
  const response = await fetch(media.src)
  const blob = await response.blob()
  // PNG is the only image type with universal clipboard support; if the
  // fetched blob is some other image type, re-encode through a canvas. The
  // blob's own type wins, but an empty string (some `data:`/`file:` blobs)
  // falls back to the declared mime, then PNG.
  const type = blob.type !== '' ? blob.type : (media.mimeType ?? 'image/png')
  if (type === 'image/png') {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return
  }
  const pngBlob = await reencodeToPng(blob)
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })])
}

/** Draw an image blob onto a canvas and read it back out as a PNG blob. */
async function reencodeToPng(blob: Blob): Promise<Blob> {
  const url = URL.createObjectURL(blob)
  try {
    const img = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas context unavailable')
    ctx.drawImage(img, 0, 0)
    const png = await new Promise<Blob | null>((resolve) => { canvas.toBlob(resolve, 'image/png') })
    if (!png) throw new Error('canvas.toBlob produced no PNG')
    return png
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => { resolve(img) }
    img.onerror = reject
    img.src = src
  })
}

/** The media element shared by the thumbnail and the enlarged view. */
const MediaElement: React.FC<{
  media: ThumbnailMedia
  className: string
  controls?: boolean
  /** Autoplay the video (muted, to satisfy browser autoplay policy). Used by
   * the enlarged view so a clicked clip starts playing immediately. */
  autoPlay?: boolean
}> = ({ media, className, controls, autoPlay }) =>
  media.kind === 'image' ? (
    <img className={className} src={media.src} alt="" draggable={false} />
  ) : (
    <video
      className={className}
      src={media.src}
      controls={controls}
      {...(autoPlay ? { autoPlay: true, muted: true, loop: true } : {})}
    />
  )

/**
 * A compact preview of an image or video. Clicking opens the media large in a
 * non-scoped, full-window overlay (truly fills the window, so a picture bigger
 * than the window is reachable); right-clicking — in both the thumbnail and
 * the enlarged view — offers "Copy" to put the media on the clipboard.
 *
 * Host-agnostic by design: it carries no copy (the host injects {@link
 * ThumbnailLabels}) and takes the media as a ready-to-render `src`, so it
 * works for an inline base64 screenshot, an on-disk screencast, a remote URL,
 * etc.
 */
export const Thumbnail: React.FC<ThumbnailProps> = ({
  media,
  title,
  labels,
  className,
  style,
  onCopied,
  onCopyError,
  'data-testid': dataTestId
}) => {
  const [enlarged, setEnlarged] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const copy = useCallback((): void => {
    copyMediaToClipboard(media).then(
      () => { onCopied?.() },
      (err: unknown) => { onCopyError?.(err) }
    )
  }, [media, onCopied, onCopyError])

  const menuItems: ContextMenuItem[] = [
    {
      id: 'copy',
      label: labels?.copy ?? '⧉',
      icon: 'copy',
      onClick: copy,
      'data-testid': 'thumbnail-copy'
    }
  ]

  const openMenu = useCallback((e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const rootTestId = dataTestId ?? 'thumbnail'

  return (
    <>
      <button
        type="button"
        className={['ecu-thumbnail', className].filter(Boolean).join(' ')}
        style={style}
        onClick={() => { setEnlarged(true) }}
        onContextMenu={openMenu}
        data-testid={rootTestId}
        data-kind={media.kind}
      >
        <MediaElement media={media} className="ecu-thumbnail-media" />
        {media.kind === 'video' && (
          <span className="ecu-thumbnail-play" aria-hidden="true">
            <i className="codicon codicon-play-circle" />
          </span>
        )}
      </button>
      {menu && (
        <ContextMenu
          visible
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onRequestClose={() => { setMenu(null) }}
          data-testid={`${rootTestId}-menu`}
        />
      )}
      {enlarged && (
        <ThumbnailEnlarged
          media={media}
          title={title}
          labels={labels}
          onCopy={copy}
          onClose={() => { setEnlarged(false) }}
          testId={`${rootTestId}-enlarged`}
        />
      )}
    </>
  )
}

/**
 * The enlarged view shown when a thumbnail is clicked. Renders the media
 * inside the shared ECUI {@link Modal} (full size, never scoped) so it gets
 * the consistent ECUI modal chrome — border, header, close button — and the
 * Modal's own Escape / close handling. The media is centered at its natural
 * size; one larger than the window scrolls within the body. Right-click on the
 * media still offers "Copy".
 */
const ThumbnailEnlarged: React.FC<{
  media: ThumbnailMedia
  title: React.ReactNode
  labels: ThumbnailLabels | undefined
  onCopy: () => void
  onClose: () => void
  testId: string
}> = ({ media, title, labels, onCopy, onClose, testId }) => {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const menuItems: ContextMenuItem[] = [
    {
      id: 'copy',
      label: labels?.copy ?? '⧉',
      icon: 'copy',
      onClick: onCopy,
      'data-testid': 'thumbnail-enlarged-copy'
    }
  ]

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="full"
      // Host supplies the header title (icon + caption); empty when omitted.
      title={title ?? ''}
      data-testid={testId}
    >
      <div
        className="ecu-thumbnail-enlarged-body"
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        <MediaElement media={media} className="ecu-thumbnail-enlarged-media" controls autoPlay />
      </div>
      {menu && (
        <ContextMenu
          visible
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onRequestClose={() => { setMenu(null) }}
          data-testid={`${testId}-menu`}
        />
      )}
    </Modal>
  )
}

export default Thumbnail
