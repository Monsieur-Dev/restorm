import { useCallback, useEffect, useState } from 'react'
import type { McpLogEntry, McpLogsSource } from './types'

/**
 * Renderer-side store for the served-MCP-call viewer. Module-level singleton
 * (pinned to `globalThis` so HMR doesn't drop the wired source) so the
 * injected IPC source survives across viewer-tab remounts — dragging the tab
 * between workbench groups tears down + recreates the component, but the
 * source registration outlives it.
 *
 * Unlike the streaming Console feed, the MCP-logs source is PULL-based: the
 * buffer lives in the main process, so the store fetches a snapshot on demand
 * and refreshes it whenever the source signals a change. One source, many
 * subscribers.
 */
class McpLogsStore {
  private source: McpLogsSource | null = null

  setSource = (source: McpLogsSource): void => {
    this.source = source
  }

  getSource = (): McpLogsSource | null => this.source
}

const STORE_GLOBAL_KEY = '__ecuiMcpLogsStore__'
const globalRef = globalThis as unknown as Record<string, McpLogsStore | undefined>
const store: McpLogsStore = globalRef[STORE_GLOBAL_KEY] ?? (globalRef[STORE_GLOBAL_KEY] = new McpLogsStore())

/**
 * Wire the MCP-logs viewer to an IPC source. Call once at renderer bootstrap,
 * passing the slice of the host's preload API that exposes the served-call
 * buffer (`getLogs` / `onChange` / optional `clear`).
 */
export function registerMcpLogsSource(source: McpLogsSource): void {
  store.setSource(source)
}

/** The currently-registered source, or null if the host hasn't wired one. */
export function getMcpLogsSource(): McpLogsSource | null {
  return store.getSource()
}

/**
 * Subscribe to the served-call buffer. Fetches an initial snapshot, then
 * re-fetches whenever the source signals a change. Returns the entries
 * (newest-first), a `loading` flag for the first fetch, a manual `refresh`,
 * and a `clear` that calls through to the source when it supports it.
 */
export function useMcpLogsFeed(): {
  entries: McpLogEntry[]
  loading: boolean
  hasSource: boolean
  canClear: boolean
  refresh: () => void
  clear: () => Promise<void>
} {
  const source = getMcpLogsSource()
  const [entries, setEntries] = useState<McpLogEntry[]>([])
  const [loading, setLoading] = useState(true)

  // Always resolves on a microtask (never sets state synchronously) so it's
  // safe to call from an effect without triggering cascading renders.
  const refresh = useCallback(() => {
    const src = getMcpLogsSource()
    void Promise.resolve(src ? src.getLogs() : []).then((next) => {
      setEntries(next)
      setLoading(false)
    }).catch(() => {
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    refresh()
    const src = getMcpLogsSource()
    if (!src) return undefined
    const off = src.onChange(() => { refresh() })
    return off
  }, [refresh])

  const clear = useCallback(async () => {
    const src = getMcpLogsSource()
    if (src?.clear) {
      await src.clear()
      refresh()
    }
  }, [refresh])

  return {
    entries,
    loading,
    hasSource: source !== null,
    canClear: source?.clear !== undefined,
    refresh,
    clear
  }
}
