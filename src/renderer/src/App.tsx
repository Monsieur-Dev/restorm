import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingsView } from './components/settings/SettingsView'

const App: React.FC = () => {
  const { t } = useTranslation()
  const [showSettings, setShowSettings] = useState(false)

  if (showSettings) {
    return (
      <SettingsView
        onClose={() => {
          setShowSettings(false)
        }}
      />
    )
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
        onClick={() => {
          setShowSettings(true)
        }}
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
        {t('app.openSettings')}
      </button>
    </div>
  )
}

export default App

