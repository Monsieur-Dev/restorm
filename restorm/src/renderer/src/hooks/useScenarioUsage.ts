import { useEffect, useState } from 'react'

/** Per-scenario usage record returned by `scenario-usage:get`. */
export interface ScenarioUsageEntry {
  count: number
  lastRunAt: string
  history: string[]
}

export type ScenarioUsageMap = Record<string, ScenarioUsageEntry>

/**
 * Streaming read of the user-level scenario-usage map persisted by
 * `ScenarioUsageService` in main — the scenario counterpart of
 * `useRequestUsage`. Returns `{}` until the initial fetch resolves, then
 * updates whenever main broadcasts `scenario-usage:changed` (after each run).
 * Keyed globally by scenario id; the caller filters against the open project's
 * tree.
 */
export function useScenarioUsage(): ScenarioUsageMap {
  const [usage, setUsage] = useState<ScenarioUsageMap>({})

  useEffect(() => {
    let cancelled = false
    const api = window.restorm?.scenarioUsage
    if (!api) return

    void api.get().then((map) => {
      if (!cancelled) setUsage(map)
    })

    const unsubscribe = api.onChanged((map) => {
      if (!cancelled) setUsage(map)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return usage
}
