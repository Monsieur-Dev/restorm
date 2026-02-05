import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, useSettingsModal } from 'electron-core-ui/renderer'

const SettingsE2ETab: React.FC = () => {
  const { t } = useTranslation()
  const { isOpen, showSettingsModal } = useSettingsModal()

  const handleOpen = useCallback(() => {
    showSettingsModal()
  }, [showSettingsModal])

  return (
    <div style={{ padding: 16 }}>
      <div style={{ marginBottom: 8 }}>
        {t('settings.harness.instructions')}
      </div>

      <Button
        data-testid="settings-e2e-open"
        onClick={handleOpen}
        options={{
          ariaLabel: t('settings.harness.openButtonAriaLabel'),
          title: t('settings.harness.openButtonAriaLabel')
        }}
      >
        {t('settings.harness.openButtonLabel')}
      </Button>

      <div data-testid="settings-e2e-ready">true</div>
      <div data-testid="settings-e2e-is-open">{String(isOpen)}</div>
    </div>
  )
}

export default SettingsE2ETab
