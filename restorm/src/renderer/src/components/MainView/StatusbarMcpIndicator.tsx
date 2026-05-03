import React, { useEffect, useState } from 'react'
import { StatusbarElement } from 'electron-core-ui/renderer'

export interface StatusbarMcpIndicatorProps {
  /** When true, render with `right-aligned` so this cell takes the
   * `margin-left: auto` slot (jumps to the right side of the statusbar
   * just before the bell). Use only when no other right-side cell is
   * rendered before it. */
  rightAligned?: boolean
}

/**
 * Surfaces the embedded MCP server's runtime state in the statusbar.
 * Mounted only when restorm was launched with `--mcp` (or `ECUI_MCP=1`)
 * — the renderer reads the runtime config once on mount; the port is
 * stable for the lifetime of the process.
 *
 * Lives immediately to the left of the bell so the meta-info zone of
 * the statusbar (env, MCP, notifications) clusters together.
 *
 * Click → click-triggered popover with the live port. Each incoming
 * MCP request from the main process bumps `pulseSignal`, which fires
 * one ripple animation on the statusbar element (handled by ECUI's
 * `StatusbarElement` itself).
 */
export const StatusbarMcpIndicator: React.FC<StatusbarMcpIndicatorProps> = ({ rightAligned = false }) => {
  const [port, setPort] = useState<number | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [pulseSignal, setPulseSignal] = useState(0)

  useEffect(() => {
    const root = window as {
      restorm?: { runtime?: { getConfig?: () => Promise<{ mcp: { enabled: boolean; port: number | null } }> } }
    }
    const getConfig = root.restorm?.runtime?.getConfig
    if (!getConfig) return
    let cancelled = false
    void getConfig().then((cfg) => {
      if (cancelled) return
      setEnabled(cfg.mcp.enabled)
      setPort(cfg.mcp.port)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!enabled) return
    const root = window as {
      restorm?: { runtime?: { onMcpRequestReceived?: (cb: () => void) => () => void } }
    }
    const subscribe = root.restorm?.runtime?.onMcpRequestReceived
    if (!subscribe) return
    return subscribe(() => {
      setPulseSignal((p) => p + 1)
    })
  }, [enabled])

  if (!enabled || port === null) return null

  return (
    <StatusbarElement
      data-testid="statusbar-mcp-indicator"
      className={rightAligned ? 'right-aligned' : ''}
      icon={{ type: 'codicon', value: 'mcp' }}
      title="mcp"
      tooltipTrigger="click"
      tooltipPlacement="above"
      pulseSignal={pulseSignal}
    >
      <div
        data-testid="statusbar-mcp-popover"
        style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}
      >
        MCP server running on port {port}
      </div>
    </StatusbarElement>
  )
}

export default StatusbarMcpIndicator
