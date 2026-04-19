/**
 * Per-file sidebar tree expansion persistence.
 *
 * Storage layout (`window.api.storage`):
 *
 *   key:   `restorm-main-sidebar:${filePath}`
 *   value: `{ expandedIds: string[] }`
 *
 * Only ids that still exist in the loaded tree are applied on restore — a
 * deleted folder id silently drops out rather than crashing the sidebar.
 */

const STORAGE_KEY_PREFIX = 'restorm-main-sidebar:'

interface StoredValue {
  expandedIds: string[]
}

interface StorageApi {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<boolean>
  delete: (key: string) => Promise<boolean>
}

function getStorageApi(): StorageApi | undefined {
  return (window as unknown as { api?: { storage?: StorageApi } }).api?.storage
}

function storageKey(filePath: string): string {
  return `${STORAGE_KEY_PREFIX}${filePath}`
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const out: string[] = []
  for (const item of value) {
    if (typeof item === 'string') out.push(item)
  }
  return out
}

/** Returns the stored ids, or `null` when no entry exists for this file. */
export async function getStoredExpansion(filePath: string): Promise<string[] | null> {
  const api = getStorageApi()
  if (!api || !filePath) return null
  const value = await api.get(storageKey(filePath))
  if (!value || typeof value !== 'object') return null
  const ids = asStringArray((value as Partial<StoredValue>).expandedIds)
  return ids
}

export async function setStoredExpansion(filePath: string, expandedIds: string[]): Promise<void> {
  const api = getStorageApi()
  if (!api || !filePath) return
  const payload: StoredValue = { expandedIds: Array.from(new Set(expandedIds)) }
  await api.set(storageKey(filePath), payload)
}

/**
 * Drop stored ids that no longer correspond to a node in the current tree.
 * Pure — kept out of the async IO wrappers so it's trivially unit-testable.
 */
export function filterKnownIds(stored: readonly string[], knownIds: Iterable<string>): string[] {
  const known = knownIds instanceof Set ? knownIds : new Set(knownIds)
  return stored.filter((id) => known.has(id))
}
