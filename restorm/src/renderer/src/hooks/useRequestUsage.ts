import { useEffect, useState } from 'react'

/** Per-request usage record returned by `request-usage:get`. */
export interface RequestUsageEntry {
  count: number
  lastSentAt: string
  history: string[]
}

export type RequestUsageMap = Record<string, RequestUsageEntry>

/**
 * Streaming read of the user-level request-usage map persisted by
 * `RequestUsageService` in main. Returns `{}` until the initial
 * fetch resolves, then updates whenever main broadcasts
 * `request-usage:changed` (after each send + after a request
 * deletion). Filtering down to a single env-folder / API is the
 * caller's job — usage is keyed globally by request id.
 */
export function useRequestUsage(): RequestUsageMap {
  const [usage, setUsage] = useState<RequestUsageMap>({})

  useEffect(() => {
    let cancelled = false
    const api = window.restorm?.requestUsage
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
