import React from 'react'
import { useTranslation } from 'react-i18next'
import { StatusbarElement } from './StatusbarElement'
import { Button } from '../Button'

export interface StatusbarMcpIndicatorProps {
  /** The MCP HTTP server's bound port, or `null` until it's known (or while
   * the server is stopped / disabled). */
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
  /** When provided, the popover shows a "view logs" link that calls this —
   * the host opens its MCP-logs viewer (tab or modal). Omitted → no link. */
  onViewLogs?: () => void
  /** Whether the server is currently accepting MCP commands. When false the
   * indicator shows a stopped/disabled state with an "Enable / Resume" button —
   * the indicator is ALWAYS rendered (even when the server is stopped), so the
   * user can always re-enable the server from the GUI. Defaults to
   * `port !== null` when omitted. */
  running?: boolean
  /** Called when the user clicks the stop/resume(enable) button in the popover.
   * The host toggles the MCP server and updates `running` accordingly. Omitted
   * → button is hidden. */
  onToggleServer?: () => void
  /**
   * Optional non-blocking Pro upsell shown inside the popover. The host passes it
   * only when the current plan lacks the advanced-MCP entitlement (e.g.
   * Community): the MCP server stays fully usable (agents drive requests for
   * free), and this just informs the user that scenarios / UI automation need
   * Pro and offers an upgrade link. Strings are host-provided (translated by the
   * host) so this component stays domain-agnostic. Omitted → nothing shown (the
   * entitled case). `onUpgrade` opens the host's pricing page in the system
   * browser.
   */
  proUpsell?: {
    /** The explanatory note (e.g. wording ③). */
    note: string
    /** The upgrade link label (e.g. « Passez à la version Pro »). */
    linkLabel: string
    /** Open the pricing page in the system browser. */
    onUpgrade: () => void
  }
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
  port,
  sessionName = '',
  pulseSignal = 0,
  rightAligned = false,
  onViewLogs,
  running,
  onToggleServer,
  proUpsell
}) => {
  const { t } = useTranslation()

  // `running` reflects whether the server currently accepts commands; it
  // defaults to the port state for callers that don't wire the toggle.
  const isRunning = running ?? (port !== null)

  // The indicator is ALWAYS rendered — even when the server is stopped — so the
  // enable/resume + logs affordances stay reachable and the user can always turn
  // MCP back on from the GUI.

  const label = sessionName ? `mcp · ${sessionName}` : 'mcp'

  return (
    <StatusbarElement
      data-testid="statusbar-mcp-indicator"
      className={`${rightAligned ? 'right-aligned' : ''}${!isRunning ? ' mcp-stopped' : ''}`.trim()}
      icon={{ type: 'codicon', value: 'mcp' }}
      title={isRunning ? label : `${label} (${t('statusbar.mcp.serverStopped')})`}
      tooltipTrigger="click"
      tooltipPlacement="above"
      pulseSignal={pulseSignal}
    >
      <div
        data-testid="statusbar-mcp-popover"
        style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}
      >
        {isRunning && port !== null
          ? <div>{t('statusbar.mcp.serverRunningOnPort', { port })}</div>
          : <div style={{ opacity: 0.7 }}>{t('statusbar.mcp.serverStopped')}</div>
        }
        {sessionName && (
          <div data-testid="statusbar-mcp-popover-session" style={{ marginTop: 4, opacity: 0.8 }}>
            {t('statusbar.mcp.sessionName', { name: sessionName })}
          </div>
        )}
        {/* Non-blocking Pro upsell (shown only for a non-entitled plan): the
            server stays usable for the free request tools; this just informs +
            offers the upgrade link. */}
        {proUpsell && (
          <div
            data-testid="statusbar-mcp-pro-upsell"
            style={{ marginTop: 8, maxWidth: 280, whiteSpace: 'normal' }}
          >
            <div style={{ opacity: 0.85 }}>{proUpsell.note}</div>
            <div style={{ marginTop: 4 }}>
              <Button
                link
                externalLink
                onClick={() => { proUpsell.onUpgrade() }}
                data-testid="statusbar-mcp-pro-upsell-link"
              >
                {proUpsell.linkLabel}
              </Button>
            </div>
          </div>
        )}
        {onToggleServer && (
          <div style={{ marginTop: 6 }}>
            <Button
              link
              icon={isRunning ? 'debug-stop' : 'debug-start'}
              onClick={() => { onToggleServer() }}
              data-testid="statusbar-mcp-toggle-server"
            >
              {isRunning ? t('statusbar.mcp.stopServer') : t('statusbar.mcp.resumeServer')}
            </Button>
          </div>
        )}
        {/* The MCP logs button is ALWAYS present whether the server is started
            or stopped — the logs (recent served calls) survive a stop, and the
            user needs them most precisely after cutting MCP on a misbehaving
            AI to review what it did. */}
        {onViewLogs && (
          <div style={{ marginTop: 6 }}>
            <Button
              link
              icon="output"
              onClick={() => { onViewLogs() }}
              data-testid="statusbar-mcp-view-logs"
            >
              {t('statusbar.mcp.viewLogs')}
            </Button>
          </div>
        )}
      </div>
    </StatusbarElement>
  )
}
