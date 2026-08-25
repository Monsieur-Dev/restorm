import { useCallback, useEffect, useState } from 'react'

/**
 * The collapsed/expanded state of the Code section's template panes, persisted
 * in the USER PROFILE through the settings/persistence service (one key holding
 * a JSON array of collapsed template ids — `SettingValue` is scalar, so it is
 * stored as a string). Template ids are globally unique, so a single key scopes
 * naturally per design. Cross-window changes arrive via `onSettingChanged`.
 */
const STORAGE_KEY = 'design.codegen:collapsedTemplates'

interface SettingsApi {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: string) => Promise<boolean>
  onSettingChanged: (cb: (key: string, value: unknown) => void) => () => void
}

function settingsApi(): SettingsApi | undefined {
  const w = window as unknown as Record<string, unknown>
  const api = w['api'] as { settings?: SettingsApi } | undefined
  return api?.settings
}

/** Parse the stored value (a JSON array of ids, or '' when unset) defensively. */
function parseIds(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw === '') return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function useCollapsedCodeTemplates(): { isCollapsed: (id: string) => boolean; toggle: (id: string) => void } {
  const [ids, setIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    const api = settingsApi()
    if (api === undefined) return
    let cancelled = false
    void api.get(STORAGE_KEY)
      .then((raw) => { if (!cancelled) setIds(new Set(parseIds(raw))) })
      .catch(() => { /* keep the default (all expanded) */ })
    const cleanup = api.onSettingChanged((key, value) => {
      if (key === STORAGE_KEY) setIds(new Set(parseIds(value)))
    })
    return () => { cancelled = true; cleanup() }
  }, [])

  const toggle = useCallback((id: string): void => {
    const next = new Set(ids)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setIds(next)
    void settingsApi()?.set(STORAGE_KEY, JSON.stringify([...next]))
  }, [ids])

  const isCollapsed = useCallback((id: string): boolean => ids.has(id), [ids])
  return { isCollapsed, toggle }
}
