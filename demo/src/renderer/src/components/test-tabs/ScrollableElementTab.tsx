import React from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollableElement } from 'electron-core-ui/renderer'

const baseBoxStyle: React.CSSProperties = {
  border: '1px solid var(--panel-border)',
  width: 420,
  height: 220
}

const longContentStyle: React.CSSProperties = {
  height: 900,
  padding: 16,
  backgroundColor: 'var(--editor-background)'
}

const wideAndTallContentStyle: React.CSSProperties = {
  width: 900,
  height: 900,
  padding: 16,
  backgroundColor: 'var(--editor-background)'
}

const ScrollableElementTab: React.FC = () => {
  const { t } = useTranslation()

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 900, padding: 20 }}>
      <div data-testid="scrollableelement-ready">true</div>

      <h3 style={{ fontSize: 16, marginBottom: 0 }}>{t('scrollableElement.harness.title')}</h3>

      <div style={{ display: 'grid', gap: 10 }}>
        <h4 style={{ fontSize: 14, marginBottom: 0 }}>{t('scrollableElement.harness.verticalAutoTitle')}</h4>
        <ScrollableElement
          data-testid="scrollableelement-vertical-auto"
          options={{ vertical: 'auto', horizontal: 'hidden', useShadows: true }}
          style={baseBoxStyle}
        >
          <div style={longContentStyle}>
            <div>{t('scrollableElement.harness.longContent')}</div>
            <div style={{ height: 700 }} />
            <div>{t('scrollableElement.harness.bottomContent')}</div>
          </div>
        </ScrollableElement>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <h4 style={{ fontSize: 14, marginBottom: 0 }}>{t('scrollableElement.harness.bothAxesArrowsTitle')}</h4>
        <ScrollableElement
          data-testid="scrollableelement-both-auto-arrows"
          options={{
            vertical: 'auto',
            horizontal: 'auto',
            verticalHasArrows: true,
            horizontalHasArrows: true,
            useShadows: true
          }}
          style={baseBoxStyle}
        >
          <div style={wideAndTallContentStyle}>
            <div>{t('scrollableElement.harness.wideAndTallContent')}</div>
            <div style={{ height: 700 }} />
            <div>{t('scrollableElement.harness.bottomContent')}</div>
          </div>
        </ScrollableElement>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <h4 style={{ fontSize: 14, marginBottom: 0 }}>{t('scrollableElement.harness.visibleTitle')}</h4>
        <ScrollableElement
          data-testid="scrollableelement-visible"
          options={{ vertical: 'visible', horizontal: 'visible', useShadows: true }}
          style={baseBoxStyle}
        >
          <div style={wideAndTallContentStyle}>
            <div>{t('scrollableElement.harness.visibleContent')}</div>
            <div style={{ height: 700 }} />
            <div>{t('scrollableElement.harness.bottomContent')}</div>
          </div>
        </ScrollableElement>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <h4 style={{ fontSize: 14, marginBottom: 0 }}>{t('scrollableElement.harness.hiddenTitle')}</h4>
        <ScrollableElement
          data-testid="scrollableelement-hidden"
          options={{ vertical: 'hidden', horizontal: 'hidden', useShadows: true }}
          style={baseBoxStyle}
        >
          <div style={longContentStyle}>
            <div>{t('scrollableElement.harness.hiddenContent')}</div>
            <div style={{ height: 700 }} />
            <div>{t('scrollableElement.harness.bottomContent')}</div>
          </div>
        </ScrollableElement>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <h4 style={{ fontSize: 14, marginBottom: 0 }}>{t('scrollableElement.harness.stickyTitle')}</h4>
        <ScrollableElement
          data-testid="scrollableelement-sticky"
          options={{ vertical: 'auto', horizontal: 'hidden', useShadows: true }}
          style={baseBoxStyle}
        >
          {/* Sticky layout reads ONLY direct children of .scrollable-content */}
          <div
            data-testid="scrollableelement-sticky-level-1"
            data-sticky-level="1"
            style={{
              padding: 12,
              backgroundColor: 'var(--panel-background)',
              borderBottom: '1px solid var(--panel-border)'
            }}
          >
            {t('scrollableElement.harness.stickyHeader1')}
          </div>
          <div
            data-testid="scrollableelement-sticky-level-2"
            data-sticky-level="2"
            style={{
              padding: 12,
              backgroundColor: 'var(--panel-background)',
              borderBottom: '1px solid var(--panel-border)'
            }}
          >
            {t('scrollableElement.harness.stickyHeader2')}
          </div>
          <div style={{ ...longContentStyle, padding: 16 }}>
            <div>{t('scrollableElement.harness.longContent')}</div>
            <div style={{ height: 700 }} />
            <div>{t('scrollableElement.harness.bottomContent')}</div>
          </div>
        </ScrollableElement>
      </div>
    </div>
  )
}

export default ScrollableElementTab
