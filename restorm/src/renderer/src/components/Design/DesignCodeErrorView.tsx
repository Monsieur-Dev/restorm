import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CodeEditor } from 'electron-core-ui/renderer'

const MAX_HEIGHT = 360
const MIN_HEIGHT = 44

/**
 * A generation/extraction failure (often a multi-line sandbox traceback) shown
 * read-only in a CodeEditor, its height auto-fitted to the content (Monaco's
 * `getContentHeight`, which accounts for word-wrap) and capped so a huge
 * traceback scrolls instead of pushing the page.
 */
export const DesignCodeErrorView: React.FC<{ text: string }> = ({ text }) => {
  const { t } = useTranslation()
  const [height, setHeight] = useState(MIN_HEIGHT)

  return (
    <div className="design-code-error" data-testid="design-code-error">
      <div className="design-code-error-head">
        <span className="codicon codicon-error" aria-hidden="true" />
        <span>{t('design.code.errorTitle', 'Generation failed')}</span>
      </div>
      <CodeEditor
        value={text}
        language="python"
        height={`${height}px`}
        onMount={(editor) => {
          const fit = (): void => {
            setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, editor.getContentHeight())))
          }
          fit()
          editor.onDidContentSizeChange(fit)
        }}
        options={{
          readOnly: true,
          wordWrap: 'on',
          minimap: { enabled: false },
          lineNumbers: 'off',
          scrollBeyondLastLine: false,
          folding: false,
          overviewRulerLanes: 0,
          renderLineHighlight: 'none'
        }}
      />
    </div>
  )
}
