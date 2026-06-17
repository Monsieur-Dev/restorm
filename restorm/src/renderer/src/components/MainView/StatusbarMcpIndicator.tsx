import React, { useEffect, useState } from 'react'
import { StatusbarMcpIndicator as EcuiStatusbarMcpIndicator } from 'electron-core-ui/renderer'

export interface StatusbarMcpIndicatorProps {
  /** See the electron-core-ui StatusbarMcpIndicator — passed straight through. */
  rightAligned?: boolean
}

/**
 * restorm container around the generic electron-core-ui `StatusbarMcpIndicator`.
 * The presentational element (label `mcp · <name>`, popover, ripple) lives in
 * ECUI; this wrapper only reads restorm's app-specific runtime config (whether
 * MCP is on, the bound port, the session name) and bumps `pulseSignal` on each
 * incoming MCP request, then hands them to the ECUI component.
 */
export const StatusbarMcpIndicator: React.FC<StatusbarMcpIndicatorProps> = ({ rightAligned = false }) => {
  const [port, setPort] = useState<number | null>(null)
  const [sessionName, setSessionName] = useState<string>('')
  const [enabled, setEnabled] = useState(false)
  const [pulseSignal, setPulseSignal] = useState(0)

  useEffect(() => {
    const root = window as {
      restorm?: { runtime?: { getConfig?: () => Promise<{ mcp: { enabled: boolean; port: number | null; sessionName: string } }> } }
    }
    const getConfig = root.restorm?.runtime?.getConfig
    if (!getConfig) return
    let cancelled = false
    void getConfig().then((cfg) => {
      if (cancelled) return
      setEnabled(cfg.mcp.enabled)
      setPort(cfg.mcp.port)
      setSessionName(cfg.mcp.sessionName)
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

  return (
    <EcuiStatusbarMcpIndicator
      enabled={enabled}
      port={port}
      sessionName={sessionName}
      pulseSignal={pulseSignal}
      rightAligned={rightAligned}
    />
  )
}

export default StatusbarMcpIndicator
