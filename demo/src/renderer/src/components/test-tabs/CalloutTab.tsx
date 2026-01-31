import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Callout } from 'electron-core-ui/renderer'

const CalloutTab: React.FC = () => {
  const { t } = useTranslation()

  const sectionStyle = useMemo<React.CSSProperties>(() => ({
    padding: 20,
    maxWidth: 900,
    display: 'grid',
    gap: 16
  }), [])

  const cardStyle = useMemo<React.CSSProperties>(() => ({
    border: '1px solid var(--panel-border)',
    backgroundColor: 'var(--sideBar-background)',
    padding: 16,
    borderRadius: 4,
    display: 'grid',
    gap: 10
  }), [])

  return (
    <div style={sectionStyle}>
      <div style={cardStyle}>
        <h3 style={{ margin: 0 }}>{t('callout.harness.title')}</h3>

        <Callout
          data-testid="callout-info"
          variant="info"
          message={t('callout.harness.message.info')}
        />

        <Callout
          data-testid="callout-warning"
          variant="warning"
          message={t('callout.harness.message.warning')}
        />

        <Callout
          data-testid="callout-error"
          variant="error"
          message={t('callout.harness.message.error')}
        />

        <Callout
          data-testid="callout-debug"
          variant="debug"
          message={t('callout.harness.message.debug')}
        />

        <Callout
          data-testid="callout-custom-icon"
          variant="info"
          icon="rocket"
          message={t('callout.harness.message.customIcon')}
        />

        <Callout
          data-testid="callout-extra-class"
          variant="warning"
          className="callout-extra-class"
          message={t('callout.harness.message.extraClass')}
        />
      </div>
    </div>
  )
}

export default CalloutTab
