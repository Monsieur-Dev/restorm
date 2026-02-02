import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HorizontalSashContainer, VerticalSashContainer } from 'electron-core-ui/renderer'

const STORAGE_VERTICAL = 'demo-e2e-sash-vertical'
const STORAGE_HORIZONTAL = 'demo-e2e-sash-horizontal'

const SashTab: React.FC = () => {
  const { t } = useTranslation()

  const [verticalResetKey, setVerticalResetKey] = useState(0)
  const [horizontalResetKey, setHorizontalResetKey] = useState(0)

  const [lastAction, setLastAction] = useState('')

  const lastActionText = useMemo(() => lastAction, [lastAction])

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 1100, padding: 20 }}>
      <div data-testid="sash-ready">true</div>

      <h3 style={{ fontSize: 16, marginBottom: 0 }}>{t('sash.harness.title')}</h3>

      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ display: 'grid', gap: 8 }}>
          <div>{t('sash.harness.verticalBasic')}</div>
          <div style={{ width: 800, height: 280, border: '1px solid var(--panel-border)', overflow: 'hidden' }}>
            <VerticalSashContainer
              data-testid="vertical-sash-basic"
              initialWidth={260}
              minLeftWidth={150}
              minRightWidth={240}
              Left={<div style={{ padding: 8 }}>{t('sash.harness.leftPane')}</div>}
              Right={<div style={{ padding: 8 }}>{t('sash.harness.rightPane')}</div>}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          <div>{t('sash.harness.horizontalBasic')}</div>
          <div style={{ width: 800, height: 360, border: '1px solid var(--panel-border)', overflow: 'hidden' }}>
            <HorizontalSashContainer
              data-testid="horizontal-sash-basic"
              initialHeight={200}
              minTopHeight={120}
              minBottomHeight={120}
              Top={<div style={{ padding: 8 }}>{t('sash.harness.topPane')}</div>}
              Bottom={<div style={{ padding: 8 }}>{t('sash.harness.bottomPane')}</div>}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          <div>{t('sash.harness.verticalWithStorage')}</div>
          <div style={{ width: 800, height: 280, border: '1px solid var(--panel-border)', overflow: 'hidden' }}>
            <VerticalSashContainer
              data-testid="vertical-sash-with-storage"
              initialWidth={260}
              minLeftWidth={150}
              minRightWidth={240}
              storageKey={STORAGE_VERTICAL}
              Left={<div style={{ padding: 8 }}>{t('sash.harness.leftPane')}</div>}
              Right={<div style={{ padding: 8 }}>{t('sash.harness.rightPane')}</div>}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          <div>{t('sash.harness.horizontalWithStorage')}</div>
          <div style={{ width: 800, height: 360, border: '1px solid var(--panel-border)', overflow: 'hidden' }}>
            <HorizontalSashContainer
              data-testid="horizontal-sash-with-storage"
              initialHeight={200}
              minTopHeight={120}
              minBottomHeight={120}
              storageKey={STORAGE_HORIZONTAL}
              Top={<div style={{ padding: 8 }}>{t('sash.harness.topPane')}</div>}
              Bottom={<div style={{ padding: 8 }}>{t('sash.harness.bottomPane')}</div>}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          <div>{t('sash.harness.verticalWithReset')}</div>
          <div style={{ width: 800, height: 280, border: '1px solid var(--panel-border)', overflow: 'hidden' }}>
            <VerticalSashContainer
              key={verticalResetKey}
              data-testid="vertical-sash-with-reset"
              initialWidth={260}
              minLeftWidth={150}
              minRightWidth={240}
              sashConfig={{
                onReset: () => {
                  setLastAction('reset:vertical')
                  setVerticalResetKey((k) => k + 1)
                }
              }}
              Left={<div style={{ padding: 8 }}>{t('sash.harness.leftPane')}</div>}
              Right={<div style={{ padding: 8 }}>{t('sash.harness.rightPane')}</div>}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          <div>{t('sash.harness.horizontalWithReset')}</div>
          <div style={{ width: 800, height: 360, border: '1px solid var(--panel-border)', overflow: 'hidden' }}>
            <HorizontalSashContainer
              key={horizontalResetKey}
              data-testid="horizontal-sash-with-reset"
              initialHeight={200}
              minTopHeight={120}
              minBottomHeight={120}
              sashConfig={{
                onReset: () => {
                  setLastAction('reset:horizontal')
                  setHorizontalResetKey((k) => k + 1)
                }
              }}
              Top={<div style={{ padding: 8 }}>{t('sash.harness.topPane')}</div>}
              Bottom={<div style={{ padding: 8 }}>{t('sash.harness.bottomPane')}</div>}
            />
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        <div data-testid="sash-last-action">{lastActionText}</div>
      </div>
    </div>
  )
}

export default SashTab
