/**
 * The body of the crash-reporting consent prompt.
 *
 * Presentational and fully controlled: it owns the checkbox state and nothing
 * else. Whether the prompt is shown at all, and what happens to the answer, are
 * decided elsewhere — here so the wording and layout can be exercised without a
 * consent service behind them.
 *
 * The checkbox starts CHECKED. That is a deliberate product choice, not an
 * accident of the default: reporting is what makes failures fixable, so the
 * prompt asks the user to confirm or decline a stance rather than to opt into
 * one from nothing. It is still a real question — nothing is sent until this is
 * answered, and unticking it is one click.
 */

import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Toggle } from 'electron-core-ui/renderer'
import { PRIVACY_POLICY_URL } from '../../../../shared/config/observability'
import './crashConsentToast.css'

export interface CrashConsentToastBodyProps {
  /** The answer in force when the prompt opened — the checkbox's initial state. */
  initialGranted: boolean
  /** Called with the user's answer when they save. */
  onSave: (granted: boolean) => void
}

export const CrashConsentToastBody: React.FC<CrashConsentToastBodyProps> = ({
  initialGranted,
  onSave
}) => {
  const { t } = useTranslation()
  const [granted, setGranted] = useState(initialGranted)

  return (
    <div className="crash-consent-toast" data-testid="crash-consent-toast">
      <p className="crash-consent-toast-text">{t('privacy.consentToast.body')}</p>
      <Toggle
        checked={granted}
        onChange={(next) => { setGranted(next) }}
        data-testid="crash-consent-toast-toggle"
      >
        {t('privacy.crashReportsTitle')}
      </Toggle>
      <div className="crash-consent-toast-actions">
        <Button
          externalLink
          className="crash-consent-toast-learn-more"
          data-testid="crash-consent-toast-learn-more"
          // Opens in the SYSTEM browser: the main process' `setWindowOpenHandler`
          // routes an http(s) `window.open` through `shell.openExternal`, outside
          // the app firewall — the same path the documentation links take, so no
          // extra bridge is needed.
          onClick={() => { window.open(PRIVACY_POLICY_URL, '_blank', 'noopener,noreferrer') }}
        >
          {t('privacy.consentToast.learnMore')}
        </Button>
        <Button
          data-testid="crash-consent-toast-save"
          onClick={() => { onSave(granted) }}
        >
          {t('privacy.consentToast.save')}
        </Button>
      </div>
    </div>
  )
}
