import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
 * The session name is rendered inline next to the `mcp` label (always
 * visible, no hover needed) so the user can tell instances apart at a
 * glance — `mcp · <session name>`. Click → click-triggered popover with
 * the live port. Each incoming MCP request from the main process bumps
 * `pulseSignal`, which fires one ripple animation on the statusbar
 * element (handled by ECUI's `StatusbarElement` itself).
 */
export const StatusbarMcpIndicator: React.FC<StatusbarMcpIndicatorProps> = ({ rightAligned = false }) => {
  const { t } = useTranslation()
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

  if (!enabled || port === null) return null

  // Inline label: `mcp` plus the session name to its right (always
  // visible) so multiple concurrent instances are distinguishable at a
  // glance. The leading `mcp` token stays untranslated (it's the
  // protocol name); the session name is the verbatim instance identity.
  const label = sessionName ? `mcp · ${sessionName}` : 'mcp'

  return (
    <StatusbarElement
      data-testid="statusbar-mcp-indicator"
      className={rightAligned ? 'right-aligned' : ''}
      icon={{ type: 'codicon', value: 'mcp' }}
      title={label}
      tooltipTrigger="click"
      tooltipPlacement="above"
      pulseSignal={pulseSignal}
    >
      <div
        data-testid="statusbar-mcp-popover"
        style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}
      >
        <div>{t('statusbar.mcp.serverRunningOnPort', { port })}</div>
        {sessionName && (
          <div data-testid="statusbar-mcp-popover-session" style={{ marginTop: 4, opacity: 0.8 }}>
            {t('statusbar.mcp.sessionName', { name: sessionName })}
          </div>
        )}
      </div>
    </StatusbarElement>
  )
}

export default StatusbarMcpIndicator
