import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Statusbar, StatusbarElement } from 'electron-core-ui/renderer'

const StatusbarTab: React.FC = () => {
  const { t } = useTranslation()

  const [actionCount, setActionCount] = useState(0)
  const [lastAction, setLastAction] = useState('')

  const onAction = (id: string): void => {
    setActionCount((c) => c + 1)
    setLastAction(id)
  }

  const warningTitle = useMemo(() => (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <i className="codicon codicon-warning" />
      <span>{t('statusbar.harness.warningTitle')}</span>
    </span>
  ), [t])

  const errorTitle = useMemo(() => (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <i className="codicon codicon-error" />
      <span>{t('statusbar.harness.errorTitle')}</span>
    </span>
  ), [t])

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 900, padding: 20 }}>
      <div data-testid="statusbar-ready">true</div>

      <h3 style={{ fontSize: 16, marginBottom: 0 }}>{t('statusbar.harness.title')}</h3>

      <div style={{ border: '1px solid var(--panel-border)', borderRadius: 6, overflow: 'hidden' }}>
        <Statusbar data-testid="statusbar-basic">
          <StatusbarElement
            data-testid="statusbar-ready-element"
            title={t('statusbar.harness.readyTitle')}
          />

          <StatusbarElement
            data-testid="statusbar-warning-element"
            title={warningTitle}
            warning
          >
            <div data-testid="statusbar-warning-tooltip-content">
              {t('statusbar.harness.warningTooltip')}
            </div>
          </StatusbarElement>

          <StatusbarElement
            data-testid="statusbar-error-element"
            title={errorTitle}
            error
            onClick={() => { onAction('error-click') }}
          >
            <div data-testid="statusbar-error-tooltip-content">
              {t('statusbar.harness.errorTooltip')}
            </div>
          </StatusbarElement>

          <StatusbarElement
            data-testid="statusbar-clickable-element"
            title={t('statusbar.harness.clickableTitle')}
            onClick={() => { onAction('clickable-click') }}
          />
        </Statusbar>
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        <div data-testid="statusbar-action-count">{String(actionCount)}</div>
        <div data-testid="statusbar-last-action">{lastAction}</div>
      </div>
    </div>
  )
}

export default StatusbarTab
