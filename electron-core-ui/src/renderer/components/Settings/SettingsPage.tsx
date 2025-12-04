import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { SelectBox } from '../SelectBox'
import { useThemeContext } from '../../contexts/useThemeContext'
import type { ISelectData } from '../SelectBox/types'
import './settings.css'

/**
 * Available languages for the application
 */
const AVAILABLE_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français' }
]

/**
 * Settings page component
 * Contains application settings UI with theme and language selectors
 */
export const SettingsPage: React.FC = () => {
  const { t, i18n } = useTranslation()
  const { themes, currentThemeId, setTheme } = useThemeContext()

  // Build theme options for SelectBox
  const themeOptions = useMemo(() => {
    return themes.map(theme => ({
      text: theme.name,
      detail: theme.type
    }))
  }, [themes])

  // Find current theme index
  const currentThemeIndex = useMemo(() => {
    const index = themes.findIndex(t => t.id === currentThemeId)
    return index >= 0 ? index : 0
  }, [themes, currentThemeId])

  // Build language options for SelectBox
  const languageOptions = useMemo(() => {
    return AVAILABLE_LANGUAGES.map(lang => ({
      text: lang.name,
      detail: lang.code.toUpperCase()
    }))
  }, [])

  // Find current language index
  const currentLanguageIndex = useMemo(() => {
    const index = AVAILABLE_LANGUAGES.findIndex(lang => lang.code === i18n.language)
    return index >= 0 ? index : 0
  }, [i18n.language])

  // Handle theme change
  const handleThemeChange = (data: ISelectData): void => {
    const selectedTheme = themes[data.index]
    if (selectedTheme) {
      void setTheme(selectedTheme.id)
    }
  }

  // Handle language change
  const handleLanguageChange = (data: ISelectData): void => {
    const selectedLanguage = AVAILABLE_LANGUAGES[data.index]
    if (selectedLanguage) {
      void i18n.changeLanguage(selectedLanguage.code)
    }
  }

  return (
    <div className="settings-page">
      <h2 className="settings-title">{t('settings.title', 'Settings')}</h2>

      <div className="settings-section">
        <div className="settings-item">
          <label className="settings-label" htmlFor="theme-select">
            {t('settings.theme', 'Theme')}
          </label>
          <SelectBox
            id="theme-select"
            className="settings-select"
            options={themeOptions}
            selected={currentThemeIndex}
            onDidSelect={handleThemeChange}
          />
        </div>

        <div className="settings-item">
          <label className="settings-label" htmlFor="language-select">
            {t('settings.language', 'Language')}
          </label>
          <SelectBox
            id="language-select"
            className="settings-select"
            options={languageOptions}
            selected={currentLanguageIndex}
            onDidSelect={handleLanguageChange}
          />
        </div>
      </div>
    </div>
  )
}

export default SettingsPage

