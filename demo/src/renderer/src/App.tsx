import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ThemeTestPage from './pages/ThemeTestPage'
import SettingsPage from './pages/SettingsPage'
import { logger, Statusbar, StatusbarElement } from 'electron-core-ui/renderer'

const App: React.FC = () => {
  const { t, i18n } = useTranslation()
  const [currentPage, setCurrentPage] = useState<'home' | 'theme-test' | 'settings'>('theme-test')

  const toggleLanguage = (): void => {
    const newLang = i18n.language === 'en' ? 'fr' : 'en'
    void i18n.changeLanguage(newLang).catch((error: unknown) => {
      logger.error('Failed to change language', { error: String(error) })
    })
  }

  // Show theme test page
  if (currentPage === 'theme-test') {
    return <ThemeTestPage />
  }

  // Show settings page
  if (currentPage === 'settings') {
    return <SettingsPage />
  }

  // Home page
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        backgroundColor: 'var(--vscode-editor-background, #1e1e1e)',
        color: 'var(--vscode-editor-foreground, #d4d4d4)'
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 1,
          fontSize: '24px',
          gap: '20px'
        }}
      >
        <h1 style={{ margin: 0 }}>{t('app.welcome')}</h1>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={toggleLanguage}
            style={{
              padding: '10px 20px',
              fontSize: '16px',
              cursor: 'pointer',
              backgroundColor: 'var(--vscode-button-background, #0e639c)',
              color: 'var(--vscode-button-foreground, #ffffff)',
              border: 'none',
              borderRadius: '2px'
            }}
          >
            {i18n.language === 'en' ? 'Français' : 'English'}
          </button>
          <button
            onClick={() => {
              setCurrentPage('theme-test')
            }}
            style={{
              padding: '10px 20px',
              fontSize: '16px',
              cursor: 'pointer',
              backgroundColor: 'var(--vscode-button-secondaryBackground, #3a3d41)',
              color: 'var(--vscode-button-secondaryForeground, #ffffff)',
              border: 'none',
              borderRadius: '2px'
            }}
          >
            Theme Test
          </button>
          <button
            onClick={() => {
              setCurrentPage('settings')
            }}
            style={{
              padding: '10px 20px',
              fontSize: '16px',
              cursor: 'pointer',
              backgroundColor: 'var(--vscode-button-secondaryBackground, #3a3d41)',
              color: 'var(--vscode-button-secondaryForeground, #ffffff)',
              border: 'none',
              borderRadius: '2px'
            }}
          >
            Settings
          </button>
        </div>
      </div>
      <Statusbar>
        <StatusbarElement title={<><i className="codicon codicon-warning"></i>test</>} warning>
          Contenu de l&apos;infobulle warning
        </StatusbarElement>
        <StatusbarElement title={<><i className="codicon codicon-error"></i>test2</>} error>
          Contenu de l&apos;infobulle error
        </StatusbarElement>
        <StatusbarElement 
          title="test3" 
          onClick={() => {
            logger.info('Statusbar element clicked')
          }}
        >
          Contenu de l&apos;infobulle cliquable
        </StatusbarElement>
        <StatusbarElement
          title={<i className="codicon codicon-bell"></i>}
          className="right-aligned"
          onClick={() => {
            logger.info('Notifications clicked')
          }}
        >
          <div>
            <div style={{ marginBottom: '8px', fontWeight: 'bold' }}>Notifications</div>
            <div style={{ marginBottom: '4px' }}>• Nouvelle mise à jour disponible</div>
            <div style={{ marginBottom: '4px' }}>• 3 fichiers modifiés</div>
            <div style={{ marginBottom: '4px' }}>• Build terminé avec succès</div>
            <div>• 2 erreurs dans le projet</div>
          </div>
        </StatusbarElement>
      </Statusbar>
    </div>
  )
}

export default App

