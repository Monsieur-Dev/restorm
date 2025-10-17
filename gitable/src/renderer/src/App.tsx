import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ThemeTestPage from './pages/ThemeTestPage'
import { logger } from 'electron-vscodelike-core-ui/renderer'

const App: React.FC = () => {
  const { t, i18n } = useTranslation()
  const [currentPage, setCurrentPage] = useState<'home' | 'theme-test'>('theme-test')

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

  // Home page
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
        fontSize: '24px',
        gap: '20px',
        backgroundColor: 'var(--vscode-editor-background, #1e1e1e)',
        color: 'var(--vscode-editor-foreground, #d4d4d4)'
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
            fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
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
            fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
            backgroundColor: 'var(--vscode-button-secondaryBackground, #3a3d41)',
            color: 'var(--vscode-button-secondaryForeground, #ffffff)',
            border: 'none',
            borderRadius: '2px'
          }}
        >
          Theme Test
        </button>
      </div>
    </div>
  )
}

export default App

