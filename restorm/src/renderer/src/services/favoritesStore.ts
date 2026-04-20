/**
 * Favorites store — persists a set of favorite request IDs per project.
 *
 * Keyed by `_projectUuid` (stamped into the collection file content).
 * Using the UUID instead of the file path means the favorites stay with
 * the project even when the user renames or moves the file outside the
 * app.
 */

const STORAGE_KEY = 'restorm:favorites'

type FavoritesState = Record<string, string[]>

/**
 * The favorites map used to be keyed by the absolute project file
 * path. Any entries left over from that build sit as dead weight
 * forever — the new UUID key never collides with them. Clear the
 * whole map on first load if every surviving key looks path-shaped
 * (contains a `/` or `\`) so users don't carry ghost entries around.
 * Idempotent: once the map is empty or entirely UUID-keyed the guard
 * does nothing.
 */
function migrateLegacyFilePathKeys(state: FavoritesState): FavoritesState {
  const keys = Object.keys(state)
  if (keys.length === 0) return state
  const allLookLikePaths = keys.every((k) => k.includes('/') || k.includes('\\'))
  if (!allLookLikePaths) return state
  // Keys are filesystem paths from the previous build — drop the lot.
  localStorage.removeItem(STORAGE_KEY)
  return {}
}

function load(): FavoritesState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) as FavoritesState : {}
    return migrateLegacyFilePathKeys(parsed)
  } catch {
    return {}
  }
}

function save(state: FavoritesState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  // Dispatch a custom event so same-window listeners can react immediately
  window.dispatchEvent(new CustomEvent('restorm:favorites-changed'))
}

export function getFavorites(projectUuid: string): string[] {
  return load()[projectUuid] ?? []
}

export function isFavorite(projectUuid: string, requestId: string): boolean {
  return getFavorites(projectUuid).includes(requestId)
}

export function addFavorite(projectUuid: string, requestId: string): void {
  const state = load()
  const list = state[projectUuid] ?? []
  if (!list.includes(requestId)) {
    state[projectUuid] = [...list, requestId]
    save(state)
  }
}

export function removeFavorite(projectUuid: string, requestId: string): void {
  const state = load()
  const list = state[projectUuid] ?? []
  const filtered = list.filter((id) => id !== requestId)
  if (filtered.length === 0) {
    const { [projectUuid]: _removed, ...rest } = state
    void _removed
    save(rest)
  } else {
    state[projectUuid] = filtered
    save(state)
  }
}

export function toggleFavorite(projectUuid: string, requestId: string): boolean {
  if (isFavorite(projectUuid, requestId)) {
    removeFavorite(projectUuid, requestId)
    return false
  }
  addFavorite(projectUuid, requestId)
  return true
}

export function reorderFavorites(projectUuid: string, orderedIds: string[]): void {
  const state = load()
  state[projectUuid] = orderedIds
  save(state)
}
