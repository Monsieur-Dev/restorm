import { useEffect, useState } from 'react'

/**
 * Read the `mcp.enabled` slice of the runtime config once on mount. The
 * value is stable for the lifetime of the process — restorm decides at
 * boot whether to start the MCP server. Components that need to lay
 * the statusbar out conditionally (e.g. App.tsx flipping the bell's
 * `right-aligned`) read this so they don't double-up the auto margin.
 */
export function useMcpEnabled(): boolean {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    const root = window as {
      restorm?: { runtime?: { getConfig?: () => Promise<{ mcp: { enabled: boolean } }> } }
    }
    const getConfig = root.restorm?.runtime?.getConfig
    if (!getConfig) return
    let cancelled = false
    void getConfig().then((cfg) => {
      if (!cancelled) setEnabled(cfg.mcp.enabled)
    })
    return () => { cancelled = true }
  }, [])
  return enabled
}
