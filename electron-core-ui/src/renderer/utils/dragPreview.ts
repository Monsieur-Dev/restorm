/**
 * Custom drag preview ("ghost") that follows the cursor during an HTML5
 * drag, independent of the native `setDragImage` — which renders blank
 * under Wayland (and is unreliable across platforms). The native image is
 * hidden with a 1×1 transparent bitmap and we position our own clone via
 * the document `dragover` stream.
 *
 * The caller builds the preview node (so it can wrap table rows, set
 * widths, etc.); this util hides the native image, places the preview at
 * the cursor, tracks it, and tears everything down on `dragend`.
 */

// 1×1 transparent GIF — used to suppress the native (blank) drag image.
const TRANSPARENT_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

export interface DragPreviewOptions {
  /** The element to show under the cursor (already styled/sized). */
  preview: HTMLElement
  /** Cursor offset within the preview, so it tracks like a grabbed sheet. */
  offsetX: number
  offsetY: number
  /** Where to mount (for theme CSS vars); defaults to nearest `.workbench`/body. */
  mountInto?: HTMLElement | null
}

export function startDragPreview(
  event: { dataTransfer: DataTransfer; clientX: number; clientY: number },
  { preview, offsetX, offsetY, mountInto }: DragPreviewOptions
): void {
  // Suppress the native drag image (blank on Wayland) — we draw our own.
  try {
    const img = new Image()
    img.src = TRANSPARENT_PIXEL
    event.dataTransfer.setDragImage(img, 0, 0)
  } catch {
    /* setDragImage can throw in odd states; the custom preview still works. */
  }

  preview.style.position = 'fixed'
  preview.style.pointerEvents = 'none'
  preview.style.zIndex = '99999'
  preview.style.left = `${event.clientX - offsetX}px`
  preview.style.top = `${event.clientY - offsetY}px`
  if (!preview.style.opacity) preview.style.opacity = '0.85'

  const root = mountInto ?? document.querySelector<HTMLElement>('.workbench') ?? document.body
  root.appendChild(preview)

  const move = (e: DragEvent): void => {
    // The drag-end `dragover`/`drag` often reports (0,0); ignore it so the
    // preview doesn't jump to the corner just before teardown.
    if (e.clientX === 0 && e.clientY === 0) return
    preview.style.left = `${e.clientX - offsetX}px`
    preview.style.top = `${e.clientY - offsetY}px`
  }
  const cleanup = (): void => {
    document.removeEventListener('dragover', move, true)
    document.removeEventListener('dragend', cleanup, true)
    document.removeEventListener('drop', cleanup, true)
    preview.remove()
  }

  document.addEventListener('dragover', move, true)
  document.addEventListener('dragend', cleanup, true)
  document.addEventListener('drop', cleanup, true)
}
