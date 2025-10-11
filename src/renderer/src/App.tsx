import React from 'react'
import { useTranslation } from 'react-i18next'

const App: React.FC = () => {
  const { t, i18n } = useTranslation()

  const toggleLanguage = (): void => {
    const newLang = i18n.language === 'en' ? 'fr' : 'en'
    i18n.changeLanguage(newLang).catch((error) => {
      console.error('Failed to change language:', error)
    })
  }

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
        backgroundColor: '#1e1e1e',
        color: '#d4d4d4'
      }}
    >
      <h1 style={{ margin: 0 }}>{t('app.welcome')}</h1>
      <button
        onClick={toggleLanguage}
        style={{
          padding: '10px 20px',
          fontSize: '16px',
          cursor: 'pointer',
          fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
          backgroundColor: '#0e639c',
          color: '#ffffff',
          border: 'none',
          borderRadius: '2px'
        }}
      >
        {i18n.language === 'en' ? 'Français' : 'English'}
      </button>
    </div>
  )
}

export default App

