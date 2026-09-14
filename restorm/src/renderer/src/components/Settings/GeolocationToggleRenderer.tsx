import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Modal, Toggle, type SettingRendererProps } from 'electron-core-ui/renderer'

/**
 * Custom settings renderer (`type: "geolocation-toggle"`) for the privacy
 * setting that shares the user's position with the embedded browser. Turning
 * it ON is a consent: the toggle first opens a dialog that says what is
 * collected and where it goes, and the setting is written only on "Allow" —
 * a decline (or closing the dialog) leaves the box unchecked. Turning it OFF
 * needs no ceremony: the main process forgets the position at once.
 */
export function GeolocationToggleRenderer({ setting, value, onChange }: SettingRendererProps): React.ReactElement {
  const { t } = useTranslation()
  const [asking, setAsking] = useState(false)
  const checked = value === true

  const request = (next: boolean): void => {
    if (!next) { onChange(false); return }
    setAsking(true)
  }

  return (
    <>
      <Toggle checked={checked} onChange={request} data-testid={`setting-toggle-${setting.storageKey}`}>
        {setting.descriptionKey ? t(setting.descriptionKey) : undefined}
      </Toggle>
      <Modal title={t('privacy.geolocationConsent.title')} isOpen={asking} onClose={() => { setAsking(false) }} size="dialog" data-testid="geolocation-consent-modal">
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{ margin: 0 }} data-testid="geolocation-consent-body">{t('privacy.geolocationConsent.body')}</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button secondary onClick={() => { setAsking(false) }} data-testid="geolocation-consent-decline">
              {t('privacy.geolocationConsent.decline')}
            </Button>
            <Button emphasis={1} onClick={() => { setAsking(false); onChange(true) }} data-testid="geolocation-consent-accept">
              {t('privacy.geolocationConsent.accept')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
