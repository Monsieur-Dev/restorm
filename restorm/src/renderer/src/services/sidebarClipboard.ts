/**
 * Sidebar item clipboard — the Cut/Copy/Paste backing for the Édition menu
 * and the sidebar context menus.
 *
 * Copy serialises the items to the SAME canonical POJO shape the .restorm
 * file uses (`prepareForSerialization`), wraps them in a marked envelope and
 * writes the JSON to the SYSTEM clipboard — so a copied request can travel
 * between two restorm windows, or be pasted into a text editor for
 * inspection. A module-level cache mirrors the payload for environments
 * where the async clipboard read is denied (unfocused window, restricted
 * context).
 *
 * The whole API deals in ARRAYS of items: single-selection today, but the
 * upcoming ctrl+click multi-selection must not force a signature change.
 *
 * Paste-side id policy: the caller MUST regenerate fresh runtime ids before
 * inserting (see `App.handlePasteItems`) — a pasted copy living next to its
 * source with the same ids would corrupt selection, favorites and events.
 */

import type { FolderItem } from '../../../shared/types/collections'
import { prepareForSerialization } from '../utils/serialization'

const CLIPBOARD_KIND = 'restorm-items'

interface SidebarClipboardEnvelope {
  kind: typeof CLIPBOARD_KIND
  items: unknown[]
}

/** In-memory mirror of the last copy — the fallback when the system
 * clipboard cannot be read back (permission denied / no focus). */
let lastCopied: unknown[] | null = null

/** Serialise + stage `items` on the system clipboard (and the fallback
 * cache). Returns the serialised POJOs, mostly for tests. */
export function copySidebarItems(items: readonly FolderItem[]): unknown[] {
  const pojos = items.map((item) => prepareForSerialization(JSON.parse(JSON.stringify(item)) as Record<string, unknown>))
  lastCopied = pojos
  const envelope: SidebarClipboardEnvelope = { kind: CLIPBOARD_KIND, items: pojos }
  // Best-effort: the write needs window focus; the cache already holds the
  // payload for the in-app paste path either way.
  navigator.clipboard.writeText(JSON.stringify(envelope, null, 2)).catch(() => undefined)
  return pojos
}

/** Read the staged items back: system clipboard first (cross-window paste),
 * falling back to the in-memory cache. Null when neither holds items. */
export async function readSidebarClipboard(): Promise<unknown[] | null> {
  try {
    const text = await navigator.clipboard.readText()
    const parsed: unknown = JSON.parse(text)
    if (parsed !== null && typeof parsed === 'object' && 'kind' in parsed && 'items' in parsed) {
      const envelope = parsed as { kind: unknown; items: unknown }
      if (envelope.kind === CLIPBOARD_KIND && Array.isArray(envelope.items) && envelope.items.length > 0) {
        return envelope.items as unknown[]
      }
    }
  } catch {
    // denied read / non-JSON clipboard — fall through to the cache
  }
  return lastCopied
}

/** Whether an in-app copy is staged (drives the Paste entry's enabled state
 * without an async clipboard read). */
export function hasSidebarClipboard(): boolean {
  return lastCopied !== null && lastCopied.length > 0
}

/** Test seam. */
export function resetSidebarClipboard(): void {
  lastCopied = null
}
