/**
 * Bridge MCP `open_console` / `console_clear` / `open_firewall`
 * tools into the renderer. Symmetric to `useMcpMiniBrowserBridge`:
 * main pushes the work onto IPC channels, this hook subscribes
 * and runs the real React / store side-effects.
 */

import { useEffect } from 'react'

interface RestormWorkbenchTabsBridge {
  onMcpOpenConsole: (cb: () => void) => () => void
  onMcpConsoleClear: (cb: () => void) => () => void
  onMcpOpenFirewall: (cb: () => void) => () => void
}

export interface UseMcpWorkbenchTabsBridgeInput {
  enabled: boolean
  /** Triggered when MCP asks to open the singleton Console tab. */
  openConsole: () => void
  /** Triggered when MCP asks to wipe the renderer-side console feed. */
  clearConsoleFeed: () => void
  /** Triggered when MCP asks to open the singleton Firewall tab. */
  openFirewall: () => void
}

export function useMcpWorkbenchTabsBridge(input: UseMcpWorkbenchTabsBridgeInput): void {
  const { enabled, openConsole, clearConsoleFeed, openFirewall } = input

  useEffect(() => {
    if (!enabled) return
    const api = (window as { restorm?: { runtime?: RestormWorkbenchTabsBridge } }).restorm?.runtime
    if (!api) return

    const offOpenConsole = api.onMcpOpenConsole(() => { openConsole() })
    const offConsoleClear = api.onMcpConsoleClear(() => { clearConsoleFeed() })
    const offOpenFirewall = api.onMcpOpenFirewall(() => { openFirewall() })

    return () => { offOpenConsole(); offConsoleClear(); offOpenFirewall() }
  }, [enabled, openConsole, clearConsoleFeed, openFirewall])
}
