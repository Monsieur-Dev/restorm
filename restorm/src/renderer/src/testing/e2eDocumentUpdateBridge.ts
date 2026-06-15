import { useEffect } from 'react'
import { eventBus } from 'electron-core-ui/renderer'
import { DocumentEvents } from '../services/DocumentEvents'

/**
 * e2e-only instrumentation for the protocol debounce assertion (Section 4 of
 * `docs/contributing/adding-a-protocol.md`): counts `document:request:updated`
 * emissions on a `window` counter so a test can verify that rapid typing into a
 * request input coalesces into at most a couple of state mutations.
 *
 * Inert in production — it's a single cheap event subscription and nothing reads
 * the counter outside e2e. Mirrors the always-wired `scenarioSuggestionsBridge`.
 */
interface DocUpdateCounterWindow {
  __e2eDocUpdateCount?: number
  __e2eResetDocUpdateCount?: () => void
}

export function useE2eDocumentUpdateBridge(): void {
  useEffect(() => {
    const w = window as unknown as DocUpdateCounterWindow
    w.__e2eDocUpdateCount = w.__e2eDocUpdateCount ?? 0
    w.__e2eResetDocUpdateCount = (): void => { w.__e2eDocUpdateCount = 0 }
    const sub = eventBus.subscribe(DocumentEvents.REQUEST_UPDATED, () => {
      w.__e2eDocUpdateCount = (w.__e2eDocUpdateCount ?? 0) + 1
    })
    return () => { sub.unsubscribe() }
  }, [])
}
