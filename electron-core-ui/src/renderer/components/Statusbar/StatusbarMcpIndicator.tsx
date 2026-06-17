import React from 'react'
import { useTranslation } from 'react-i18next'
import StatusbarElement from './StatusbarElement'

export interface StatusbarMcpIndicatorProps {
  /** Whether the embedded MCP server is enabled / running. When false (or
   * `port` is null) the indicator renders nothing. */
  enabled: boolean
  /** The MCP HTTP server's bound port, or `null` until it's known. */
  port: number | null
  /** Human-readable session name for this instance (e.g. a ticket name).
   * Rendered inline next to the `mcp` label as `mcp · <name>` so multiple
   * concurrent instances are distinguishable at a glance. Empty → just `mcp`. */
  sessionName?: string
  /** Bump this number on every served MCP request to fire one ripple on the
   * statusbar element (handled by {@link StatusbarElement}). */
  pulseSignal?: number
  /** When true, render with `right-aligned` so this cell takes the
   * `margin-left: auto` slot (jumps to the right of the statusbar before the
   * bell). Use only when no other right-side cell renders before it. */
  rightAligned?: boolean
}

/**
 * Generic statusbar indicator for an embedded MCP server (electron-core-ui's
 * {@link McpService}). Purely presentational — the consuming app reads its own
 * runtime config (enabled / port / session name) and per-request activity and
 * feeds them in as props; this component owns the rendering, the inline
 * `mcp · <name>` label, the click-popover (port + session), and the
 * activity ripple. The leading `mcp` token stays untranslated (protocol name);
 * the popover strings come from the `statusbar.mcp.*` i18n keys shipped with
 * electron-core-ui.
 */
export const StatusbarMcpIndicator: React.FC<StatusbarMcpIndicatorProps> = ({
  enabled,
  port,
  sessionName = '',
  pulseSignal = 0,
  rightAligned = false
}) => {
  const { t } = useTranslation()

  if (!enabled || port === null) return null

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
