/**
 * Recently-used code templates — a small user-level MRU list (TASK-468.20),
 * distinct from the per-design template list. It feeds the "Recent" tab of the
 * template library modal so a user who generates the same stack across designs
 * finds it in one click. Stored in USER settings (not the project) under a
 * single key, JSON-encoded because the settings store is scalar-only, and
 * capped at {@link MAX_RECENT}. A missing/blank key reads as an empty list
 * (the settings store returns '' for an unresolved key).
 */

import type { DesignTemplateSource } from '../../../../shared/types/collections'

const RECENT_KEY = 'design:codegen:recentTemplates'
const MAX_RECENT = 10

export interface RecentTemplate {
  source: DesignTemplateSource
  /** Human label captured at use time (official title / repo / folder). */
  label: string
}

/** A stable identity for de-duplication — two entries with the same source
 * kind + target collapse to one (the most recent wins). */
export function recentSourceKey(source: DesignTemplateSource): string {
  if (source.kind === 'repo') return `repo:${source.repo}${source.ref !== undefined ? `@${source.ref}` : ''}`
  return `local:${source.path}`
}

function isRecent(value: unknown): value is RecentTemplate {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  const source = record['source']
  return (
    typeof record['label'] === 'string' &&
    source !== null &&
    typeof source === 'object' &&
    typeof (source as Record<string, unknown>)['kind'] === 'string'
  )
}

export async function loadRecentTemplates(): Promise<RecentTemplate[]> {
  const raw = await window.api.settings.get(RECENT_KEY)
  if (typeof raw !== 'string' || raw === '') return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isRecent).slice(0, MAX_RECENT)
  } catch {
    return []
  }
}

/** Record a template as most-recently-used: unshift, de-dupe by source, cap. */
export async function pushRecentTemplate(entry: RecentTemplate): Promise<void> {
  const current = await loadRecentTemplates()
  const key = recentSourceKey(entry.source)
  const next = [entry, ...current.filter((r) => recentSourceKey(r.source) !== key)].slice(0, MAX_RECENT)
  await window.api.settings.set(RECENT_KEY, JSON.stringify(next))
}
