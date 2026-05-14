/**
 * Bridge MCP `open_console` / `console_clear` / `open_firewall` /
 * `set_tab_maximized` tools into the renderer. Symmetric to
 * `useMcpMiniBrowserBridge`: main pushes the work onto IPC channels,
 * this hook subscribes and runs the real React / store side-effects.
 */

import { useEffect } from 'react'

interface RestormWorkbenchTabsBridge {
  onMcpOpenConsole: (cb: () => void) => () => void
  onMcpConsoleClear: (cb: () => void) => () => void
  onMcpOpenFirewall: (cb: () => void) => () => void
  onMcpSetTabMaximized: (cb: (payload: { tabId: string | null; maximized: boolean }) => void) => () => void
}

export interface UseMcpWorkbenchTabsBridgeInput {
  enabled: boolean
  /** Triggered when MCP asks to open the singleton Console tab. */
  openConsole: () => void
  /** Triggered when MCP asks to wipe the renderer-side console feed. */
  clearConsoleFeed: () => void
  /** Triggered when MCP asks to open the singleton Firewall tab. */
  openFirewall: () => void
  /**
   * Triggered when MCP asks to maximize a workbench tab (`tabId` set,
   * `maximized: true`) or restore the maximized tab (`tabId: null`,
   * `maximized: false`).
   */
  setTabMaximized: (payload: { tabId: string | null; maximized: boolean }) => void
}

export function useMcpWorkbenchTabsBridge(input: UseMcpWorkbenchTabsBridgeInput): void {
  const { enabled, openConsole, clearConsoleFeed, openFirewall, setTabMaximized } = input

  useEffect(() => {
    if (!enabled) return
    const api = (window as { restorm?: { runtime?: RestormWorkbenchTabsBridge } }).restorm?.runtime
    if (!api) return

    const offOpenConsole = api.onMcpOpenConsole(() => { openConsole() })
    const offConsoleClear = api.onMcpConsoleClear(() => { clearConsoleFeed() })
    const offOpenFirewall = api.onMcpOpenFirewall(() => { openFirewall() })
    const offSetTabMaximized = api.onMcpSetTabMaximized((payload) => { setTabMaximized(payload) })

    return () => { offOpenConsole(); offConsoleClear(); offOpenFirewall(); offSetTabMaximized() }
  }, [enabled, openConsole, clearConsoleFeed, openFirewall, setTabMaximized])
}
