import React from 'react'
import { useTranslation } from 'react-i18next'
import { Titlebar, MenuBar, MenuBarItem, Statusbar } from 'electron-core-ui/renderer'

const App: React.FC = () => {
  const { t } = useTranslation()

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        backgroundColor: 'var(--vscode-editor-background)',
        color: 'var(--vscode-editor-foreground)'
      }}
    >
      <Titlebar
        title={t('app.title')}
        leftContent={
          <MenuBar>
            <MenuBarItem title={t('menuBar.file')} />
          </MenuBar>
        }
      />
      <div style={{ flex: 1 }} />
      <Statusbar />
    </div>
  )
}

export default App
