import React from 'react'
import type { SettingRendererProps } from 'electron-core-ui/renderer'

const DemoCustomRenderer: React.FC<SettingRendererProps> = ({ value }) => {
  return (
    <div
      data-testid="demo-custom-renderer"
      style={{
        padding: '8px 12px',
        borderRadius: 4,
        border: '1px solid var(--editorWidget-border)',
        backgroundColor: 'var(--editorWidget-background)',
        fontSize: 13
      }}
    >
      {String(value)}
    </div>
  )
}

export default DemoCustomRenderer
