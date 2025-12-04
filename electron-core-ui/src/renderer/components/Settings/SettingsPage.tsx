import React from 'react'

/**
 * Settings page component
 * Contains application settings UI
 */
export const SettingsPage: React.FC = () => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        padding: 16,
        boxSizing: 'border-box',
        color: 'var(--vscode-editor-foreground, #d4d4d4)'
      }}
    >
      <h2 style={{ margin: '0 0 16px 0' }}>Settings</h2>
      <p>Hello World</p>
    </div>
  )
}

export default SettingsPage

