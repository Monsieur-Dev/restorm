import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StatusbarMcpIndicator as EcuiStatusbarMcpIndicator } from 'electron-core-ui/renderer'
import { useCapability } from '../../hooks/useCapability'

export interface StatusbarMcpIndicatorProps {
  /** See the electron-core-ui StatusbarMcpIndicator — passed straight through. */
  rightAligned?: boolean
  /** Open the MCP call-logs viewer (the popover "view logs" link). When
   * omitted, the link is hidden. */
  onViewLogs?: () => void
}

/**
 * restorm container around the generic electron-core-ui `StatusbarMcpIndicator`.
 * The presentational element (label `mcp · <name>`, popover, ripple) lives in
 * ECUI; this wrapper only reads restorm's app-specific runtime config (whether
 * MCP is on, the bound port, the session name) and bumps `pulseSignal` on each
 * incoming MCP request, then hands them to the ECUI component. Also wires the
 * runtime stop/resume toggle so the user can stop or resume the server without
 * restarting restorm.
 */
export const StatusbarMcpIndicator: React.FC<StatusbarMcpIndicatorProps> = ({ rightAligned = false, onViewLogs }) => {
  const { t } = useTranslation()
  const [port, setPort] = useState<number | null>(null)
  const [sessionName, setSessionName] = useState<string>('')
  const [running, setRunning] = useState(false)
  const [pulseSignal, setPulseSignal] = useState(0)
  // Channel-resolved pricing URL, read from the per-boot runtime config so the
  // upsell link and the MCP 402 refusal (resolved main-side) point at the SAME
  // page (dev site on preview builds, restorm.app on release).
  const [pricingUrl, setPricingUrl] = useState<string | null>(null)

  // The advanced MCP tools (scenarios, captures, UI automation, multi-instance)
  // require Pro; without the live `mcp.pro` capability we surface a non-blocking
  // upsell in the popover. The server itself stays usable — Community drives
  // requests for free — so we never gate the toggle, only inform + offer upgrade.
  const mcpPro = useCapability('mcp.pro')

  useEffect(() => {
    const root = window as {
      restorm?: { runtime?: { getConfig?: () => Promise<{ mcp: { enabled: boolean; port: number | null; sessionName: string; running?: boolean }; pricingUrl?: string }> } }
    }
    const getConfig = root.restorm?.runtime?.getConfig
    if (!getConfig) return
    let cancelled = false
    void getConfig().then((cfg) => {
      if (cancelled) return
      setPort(cfg.mcp.port)
      setSessionName(cfg.mcp.sessionName)
      // `running` was added alongside the toggle; fall back to port!=null for
      // builds that predate this ticket.
      setRunning(cfg.mcp.running ?? cfg.mcp.port !== null)
      if (cfg.pricingUrl) setPricingUrl(cfg.pricingUrl)
    })
    return () => { cancelled = true }
  }, [])

  // Always subscribe (NOT gated on the initial enabled state): an instance
  // whose MCP server was stopped at runtime starts disabled but must still
  // react when the user resumes it from the GUI — the indicator stays present
  // and interactive.
  useEffect(() => {
    const root = window as {
      restorm?: { runtime?: { onMcpRequestReceived?: (cb: () => void) => () => void } }
    }
    const subscribe = root.restorm?.runtime?.onMcpRequestReceived
    if (!subscribe) return
    return subscribe(() => {
      setPulseSignal((p) => p + 1)
    })
  }, [])

  // Subscribe to runtime state-change events so the indicator updates immediately
  // when the user stops or resumes/enables the server via the toggle button.
  useEffect(() => {
    const root = window as {
      restorm?: { runtime?: { onMcpServerStateChanged?: (cb: (state: { running: boolean; port: number | null }) => void) => () => void } }
    }
    const subscribe = root.restorm?.runtime?.onMcpServerStateChanged
    if (!subscribe) return
    return subscribe((state) => {
      setRunning(state.running)
      // Restore the freshly-bound port on resume (a stop reports port=null).
      setPort(state.port)
    })
  }, [])

  const handleToggleServer = useCallback(() => {
    const root = window as {
      restorm?: { runtime?: { toggleServer?: () => Promise<{ running: boolean; port: number | null }> } }
    }
    const toggle = root.restorm?.runtime?.toggleServer
    if (!toggle) return
    void toggle().then((result) => {
      setRunning(result.running)
      // Restore the freshly-bound port on resume (a stop reports port=null).
      setPort(result.port)
    })
  }, [])

  // Open the pricing page in the SYSTEM browser. The main process'
  // `setWindowOpenHandler` routes `window.open` of an http(s) URL through
  // `shell.openExternal` (outside the app firewall), so no extra bridge / raw
  // anchor is needed — the same path the documentation host uses for its links.
  const handleUpgrade = useCallback(() => {
    if (!pricingUrl) return
    window.open(pricingUrl, '_blank', 'noopener,noreferrer')
  }, [pricingUrl])

  // Show the upsell only for a non-Pro plan AND once the channel-resolved pricing
  // URL has loaded (so the link never dead-clicks).
  const showUpsell = !mcpPro && pricingUrl !== null

  return (
    <EcuiStatusbarMcpIndicator
      port={port}
      sessionName={sessionName}
      pulseSignal={pulseSignal}
      rightAligned={rightAligned}
      running={running}
      onToggleServer={handleToggleServer}
      {...(onViewLogs ? { onViewLogs } : {})}
      {...(showUpsell
        ? {
            proUpsell: {
              note: t('mcp.proUpsell.note'),
              linkLabel: t('mcp.proUpsell.link'),
              onUpgrade: handleUpgrade
            }
          }
        : {})}
    />
  )
}
