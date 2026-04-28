import type { ApiUpdateConfig, ImportSourceType } from '../types/baseTypes'

interface FolderLike {
  apiUpdate?: ApiUpdateConfig
  apiDocumentation?: { sourceUrl?: string; sourceHeaders?: Record<string, string>; api?: { version?: string } }
  items?: unknown[]
  importSource?: string
}

interface RequestLike {
  type?: string
  method?: string
  url?: string
  importOrigin?: { format: ImportSourceType; naturalKey: string; operationId?: string }
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
  const sourceUrl = folder.apiDocumentation?.sourceUrl
  // Two paths converge here. (1) Legacy folder with no apiUpdate:
  // create one from the apiDocumentation marker. (2) Partial
  // apiUpdate (the import wizard stamps `authenticationRequestId`
  // before the migration runs, leaving sourceUrl / autoCheckEnabled
  // / interval to be filled): merge sane defaults under whatever
  // the wizard set so the "Refresh from source" entry surfaces
  // without waiting for a project reload.
  if (folder.apiUpdate) {
    // Cast through Partial because the import wizard stamps a
    // partial config (just `authenticationRequestId`) before the
    // migration runs — at that point the type's required fields
    // genuinely are missing, even though TS's view of the value
    // says otherwise.
    const existing = folder.apiUpdate as Partial<ApiUpdateConfig>
    const merged: ApiUpdateConfig = {
      sourceUrl: existing.sourceUrl ?? sourceUrl ?? '',
      autoCheckEnabled: existing.autoCheckEnabled ?? false,
      interval: existing.interval ?? 'daily',
      ...existing
    } as ApiUpdateConfig
    folder.apiUpdate = merged
    return walk(folder)
  }
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

/**
 * Best-effort backfill of `importOrigin` on legacy requests that
 * predate the field. Without this, the very first refresh on a
 * legacy folder would treat every existing request as user-created
 * (no `importOrigin.format` match) and the new spec would add every
 * operation a second time.
 *
 * Only HTTP-shaped requests get a synthesised `importOrigin` —
 * GraphQL / gRPC / SOAP / OData need more context (operationType +
 * fieldName, service.method, etc.) than method + url, and stamping
 * the wrong origin would be worse than leaving them unmatched. Those
 * fall back to the pipeline's existing user-created behaviour
 * (untouched on refresh).
 */
function backfillImportOriginOnRequests(folder: FolderLike, format: ImportSourceType): void {
  if (!Array.isArray(folder.items)) return
  for (const item of folder.items) {
    if (!item || typeof item !== 'object') continue
    if ('items' in item) {
      backfillImportOriginOnRequests(item as FolderLike, format)
      continue
    }
    const req = item as RequestLike
    if (req.importOrigin) continue
    if (req.type !== 'http' && req.type !== 'authentication') continue
    if (!req.method || !req.url) continue
    req.importOrigin = {
      format,
      naturalKey: `${req.method.toUpperCase()} ${req.url}`
    }
  }
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
  for (const c of collections) {
    migrateApiUpdate(c)
    if (c.importSource === 'swagger' || c.importSource === 'openapi') {
      backfillImportOriginOnRequests(c, c.importSource)
    }
  }
  return collections
}
