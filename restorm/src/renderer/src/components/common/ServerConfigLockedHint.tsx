import React, { type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

const hintStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  color: 'var(--foreground-muted)',
  padding: '2px 0'
}

export interface ServerConfigLockedHintProps {
  'data-testid'?: string
}

/**
 * Muted inline row for a mock/embedded server's config pane while it is
 * listening: its config was snapshotted on start, so live edits don't reach
 * the served responses until the server is stopped (and restarted). Render
 * it alongside `disabled`/`readOnly` on every config control in the same
 * pane — the row is the visible "why", the disabled controls are the
 * enforcement. Mirrors the `codicon-lock` + "locked while running" pattern
 * used for a running scenario's graph.
 */
export const ServerConfigLockedHint: React.FC<ServerConfigLockedHintProps> = ({
  'data-testid': dataTestId = 'server-config-locked-hint'
}) => {
  const { t } = useTranslation()
  return (
    <div style={hintStyle} data-testid={dataTestId}>
      <span className="codicon codicon-lock" aria-hidden="true" />
      <span>{t('server.configLockedWhileRunning', 'Config locked while the server is running')}</span>
    </div>
  )
}

export default ServerConfigLockedHint
