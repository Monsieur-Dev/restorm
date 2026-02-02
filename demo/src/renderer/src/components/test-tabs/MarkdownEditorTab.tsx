import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MarkdownEditor } from 'electron-core-ui/renderer'

const MarkdownEditorTab: React.FC = () => {
  const { t } = useTranslation()

  const initialValue = t('markdownEditor.harness.initialValue')
  const [changeCount, setChangeCount] = useState(0)
  const [lastChange, setLastChange] = useState('')

  const lastChangeText = useMemo(() => lastChange, [lastChange])

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 1100, padding: 20, height: '100%' }}>
      <div data-testid="markdowneditor-ready">true</div>

      <h3 style={{ fontSize: 16, marginBottom: 0 }}>{t('markdownEditor.harness.title')}</h3>

      <div style={{ border: '1px solid var(--panel-border)', height: 420, overflow: 'hidden' }}>
        <MarkdownEditor
          data-testid="markdowneditor-basic"
          initialValue={initialValue}
          onChange={(md) => {
            setLastChange(md)
            setChangeCount((c) => c + 1)
          }}
        />
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        <div data-testid="markdowneditor-change-count">{String(changeCount)}</div>
        <div data-testid="markdowneditor-last-change">{lastChangeText}</div>
      </div>
    </div>
  )
}

export default MarkdownEditorTab
