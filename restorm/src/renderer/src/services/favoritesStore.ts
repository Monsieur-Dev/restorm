/**
 * Favorites store — persists a set of favorite request IDs per file path.
 * Uses localStorage for persistence across sessions.
 */

const STORAGE_KEY = 'restorm:favorites'

type FavoritesState = Record<string, string[]>

function load(): FavoritesState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) as FavoritesState : {}
  } catch {
    return {}
  }
}

function save(state: FavoritesState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  // Dispatch a custom event so same-window listeners can react immediately
  window.dispatchEvent(new CustomEvent('restorm:favorites-changed'))
}

export function getFavorites(filePath: string): string[] {
  return load()[filePath] ?? []
}

export function isFavorite(filePath: string, requestId: string): boolean {
  return getFavorites(filePath).includes(requestId)
}

export function addFavorite(filePath: string, requestId: string): void {
  const state = load()
  const list = state[filePath] ?? []
  if (!list.includes(requestId)) {
    state[filePath] = [...list, requestId]
    save(state)
  }
}

export function removeFavorite(filePath: string, requestId: string): void {
  const state = load()
  const list = state[filePath] ?? []
  state[filePath] = list.filter((id) => id !== requestId)
  save(state)
}

export function toggleFavorite(filePath: string, requestId: string): boolean {
  if (isFavorite(filePath, requestId)) {
    removeFavorite(filePath, requestId)
    return false
  }
  addFavorite(filePath, requestId)
  return true
}

export function reorderFavorites(filePath: string, orderedIds: string[]): void {
  const state = load()
  state[filePath] = orderedIds
  save(state)
}
