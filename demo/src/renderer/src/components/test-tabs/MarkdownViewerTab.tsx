import React from 'react'
import { useTranslation } from 'react-i18next'
import { MarkdownViewer } from 'electron-core-ui/renderer'

const MarkdownViewerTab: React.FC = () => {
  const { t } = useTranslation()

  const sampleMarkdown = t('markdownViewer.harness.sampleMarkdown')

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 1100, padding: 20 }}>
      <div data-testid="markdownviewer-ready">true</div>

      <h3 style={{ fontSize: 16, marginBottom: 0 }}>{t('markdownViewer.harness.title')}</h3>

      <div style={{ display: 'grid', gap: 16 }}>
        <div style={{ display: 'grid', gap: 8 }}>
          <div>{t('markdownViewer.harness.basic')}</div>
          <div style={{ border: '1px solid var(--panel-border)', height: 380, overflow: 'hidden' }}>
            <MarkdownViewer data-testid="markdownviewer-basic" value={sampleMarkdown} allowMermaid={true} />
          </div>
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          <div>{t('markdownViewer.harness.noMermaid')}</div>
          <div style={{ border: '1px solid var(--panel-border)', height: 380, overflow: 'hidden' }}>
            <MarkdownViewer data-testid="markdownviewer-no-mermaid" value={sampleMarkdown} allowMermaid={false} />
          </div>
        </div>
      </div>
    </div>
  )
}

export default MarkdownViewerTab
