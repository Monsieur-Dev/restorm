import type { ApiUpdateConfig } from '../types/baseTypes'

interface FolderLike {
  apiUpdate?: ApiUpdateConfig
  apiDocumentation?: { sourceUrl?: string; sourceHeaders?: Record<string, string>; api?: { version?: string } }
  items?: unknown[]
  importSource?: string
}

/**
 * Backfill `apiUpdate` from the legacy `apiDocumentation.sourceUrl`
 * marker for env folders that pre-date the field. Runs both on the
 * main side (so the scheduler picks up legacy folders) and on the
 * renderer side (so the settings UI reflects the same default
 * before any user edit) — the function is pure and idempotent, so
 * double-application is safe.
 *
 * Defaults chosen for legacy folders:
 *
 * - `autoCheckEnabled: false` — opt-in until the user enables it
 *   from the settings section. Auto-firing on a legacy folder the
 *   user hasn't touched in a year would surface noisy "available"
 *   notifications for things they might not care about anymore.
 * - `interval: 'daily'` — the most common cadence; cheap to run, low
 *   noise. The user can change it in one click.
 * - `lastImportedSpecVersion`: copied from `apiDocumentation.api.version`
 *   when present so the first auto-check can issue a meaningful
 *   "version → version" comparison.
 */
export function migrateApiUpdate<T extends FolderLike>(folder: T): T {
  if (folder.apiUpdate) return walk(folder)
  const sourceUrl = folder.apiDocumentation?.sourceUrl
  if (!sourceUrl) return walk(folder)
  const apiUpdate: ApiUpdateConfig = {
    sourceUrl,
    autoCheckEnabled: false,
    interval: 'daily'
  }
  const apiDoc = folder.apiDocumentation
  if (apiDoc?.sourceHeaders) {
    apiUpdate.sourceHeaders = apiDoc.sourceHeaders
  }
  if (apiDoc?.api?.version) {
    apiUpdate.lastImportedSpecVersion = apiDoc.api.version
  }
  folder.apiUpdate = apiUpdate
  return walk(folder)
}

function walk<T extends FolderLike>(folder: T): T {
  if (Array.isArray(folder.items)) {
    for (const child of folder.items) {
      if (child && typeof child === 'object' && 'items' in (child as FolderLike)) {
        migrateApiUpdate(child as FolderLike)
      }
    }
  }
  return folder
}

export function migrateApiUpdateForCollections<T extends FolderLike>(collections: T[]): T[] {
  for (const c of collections) migrateApiUpdate(c)
  return collections
}
