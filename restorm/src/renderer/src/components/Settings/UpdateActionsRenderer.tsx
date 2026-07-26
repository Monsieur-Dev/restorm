import React from 'react'
import { useTranslation } from 'react-i18next'
import { Button, type SettingRendererProps } from 'electron-core-ui/renderer'
import { useUpdateState } from '../../hooks/useUpdateState'
import './updateActions.css'

/**
 * Custom settings renderer (`type: "update-actions"`) for the "Updates" group:
 * shows the running version + a live status line + a "Check now" button
 * (disabled while a check is in flight). The bound setting carries no persisted
 * value — it is a live action control — so `value`/`onChange` are ignored.
 */
export function UpdateActionsRenderer(_props: SettingRendererProps): React.ReactElement {
  const { t } = useTranslation()
  const { state, settings, checkNow } = useUpdateState()

  const version = settings?.currentVersion ?? state?.currentVersion ?? ''
  const checking = state?.phase === 'checking'

  let status: string
  switch (state?.phase) {
    case 'checking':
      status = t('updates.status.checking')
      break
    case 'available':
    case 'downloading':
      status = t('updates.status.downloading', { percent: state.percent ?? 0 })
      break
    case 'downloaded':
      status = t('updates.status.downloaded', { version: state.version ?? '' })
      break
    case 'error':
      status = t('updates.status.error')
      break
    default:
      status = t('updates.status.idle')
  }

  return (
    <div className="update-actions" data-testid="update-actions">
      <div className="update-actions-info">
        <span className="update-actions-version">
          {t('updates.currentVersion', { version })}
        </span>
        <span className="update-actions-status" data-testid="update-actions-status">
          {status}
        </span>
      </div>
      <Button
        appearance="default"
        disabled={checking}
        onClick={() => {
          void checkNow()
        }}
        data-testid="update-check-now"
      >
        {t('updates.checkNow')}
      </Button>
    </div>
  )
}
