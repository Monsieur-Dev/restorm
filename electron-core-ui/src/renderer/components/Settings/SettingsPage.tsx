import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { SelectBox } from '../SelectBox'
import type { ISelectData } from '../SelectBox/types'
import { ThemeCarousel } from './ThemeCarousel'
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

  // Handle language change
  const handleLanguageChange = (data: ISelectData): void => {
    const selectedLanguage = AVAILABLE_LANGUAGES[data.index]
    if (selectedLanguage) {
      void i18n.changeLanguage(selectedLanguage.code)
    }
  }

  return (
    <div className="settings-page">
      <div className="settings-section">
        <div className="settings-item">
          <h1 className="settings-label">
            {t('settings.theme', 'Theme')}
          </h1>
          <ThemeCarousel />
        </div>

        <div className="settings-item">
          <h1 className="settings-label">
            {t('settings.language', 'Language')}
          </h1>
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
