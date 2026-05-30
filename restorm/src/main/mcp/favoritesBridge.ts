/**
 * Main-side cache of the renderer's item-favorites, fed over IPC so the
 * `list_favorites` MCP tool can read them — the favorites store lives in
 * the renderer (localStorage, keyed by project UUID), so main has no
 * direct view. Mirrors the `activeState` bridge: the renderer pushes the
 * resolved favorites on mount + whenever they change; main caches the
 * latest snapshot.
 */
import { ipcMain } from 'electron'

export interface FavoriteItem { id: string; name: string; type: string }
interface FavoritesSnapshot { projectUuid: string | null; favorites: FavoriteItem[] }

let snapshot: FavoritesSnapshot = { projectUuid: null, favorites: [] }
let registered = false

/** Wire the renderer→main favorites push. Idempotent. */
export function registerFavoritesBridge(): void {
  if (registered) return
  registered = true
  ipcMain.on('mcp:favorites-changed', (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') return
    const p = payload as Record<string, unknown>
    const projectUuid = typeof p['projectUuid'] === 'string' ? p['projectUuid'] : null
    const rawList = Array.isArray(p['favorites']) ? p['favorites'] : []
    const favorites: FavoriteItem[] = []
    for (const raw of rawList) {
      if (!raw || typeof raw !== 'object') continue
      const r = raw as Record<string, unknown>
      const id = typeof r['id'] === 'string' ? r['id'] : null
      if (!id) continue
      favorites.push({ id, name: typeof r['name'] === 'string' ? r['name'] : '', type: typeof r['type'] === 'string' ? r['type'] : '' })
    }
    snapshot = { projectUuid, favorites }
  })
}

/** The latest favorites snapshot pushed by the renderer (active project). */
export function getFavoritesSnapshot(): FavoritesSnapshot {
  return { projectUuid: snapshot.projectUuid, favorites: [...snapshot.favorites] }
}
