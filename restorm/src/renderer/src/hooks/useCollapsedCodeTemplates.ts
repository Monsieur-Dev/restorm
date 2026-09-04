import { useCallback, useEffect, useState } from 'react'

/**
 * The collapsed/expanded state of the Code section's template panes, persisted
 * in the USER PROFILE through the settings/persistence service (one key holding
 * a JSON array of collapsed template ids — `SettingValue` is scalar, so it is
 * stored as a string). Template ids are globally unique, so a single key scopes
 * naturally per design. Cross-window changes arrive via `onSettingChanged`.
 *
 * `loaded` gates the first render: the SplitView reads each pane's
 * `defaultCollapsed` once at mount, so the persisted set must be in hand before
 * the panes mount.
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

export function useCollapsedCodeTemplates(): {
  loaded: boolean
  collapsedIds: Set<string>
  setCollapsedIds: (ids: string[]) => void
} {
  const [ids, setIds] = useState<Set<string>>(new Set())
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const api = settingsApi()
    let cancelled = false
    // Resolve the initial value through a Promise (empty when the service is
    // absent) so state is only set from an async callback, then unblock render.
    const load: Promise<unknown> = api === undefined ? Promise.resolve('') : api.get(STORAGE_KEY).catch(() => '')
    void load.then((raw) => {
      if (cancelled) return
      setIds(new Set(parseIds(raw)))
      setLoaded(true)
    })
    const cleanup = api?.onSettingChanged((key, value) => {
      if (key === STORAGE_KEY) setIds(new Set(parseIds(value)))
    })
    return () => { cancelled = true; cleanup?.() }
  }, [])

  const setCollapsedIds = useCallback((next: string[]): void => {
    setIds(new Set(next))
    void settingsApi()?.set(STORAGE_KEY, JSON.stringify(next))
  }, [])

  return { loaded, collapsedIds: ids, setCollapsedIds }
}
