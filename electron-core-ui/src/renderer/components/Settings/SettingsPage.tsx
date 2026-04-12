import React, { useContext, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { SelectBox } from '../SelectBox'
import type { ISelectData } from '../SelectBox/types'
import { ThemeCarousel } from './ThemeCarousel'
import { SettingsView } from './SettingsView'
import { SettingsContext } from '../../contexts/settingsContextDef'
import './settings.css'

export interface SettingsPageProps {
  /** Optional test id applied to the root element. Defaults to `settings-page`. */
  'data-testid'?: string
  /** Optional test id applied to the ThemeCarousel. Defaults to `{data-testid}-theme-carousel`. */
  themeCarouselTestId?: string
  /** Optional test id applied to the language SelectBox. Defaults to `{data-testid}-language-selectbox`. */
  languageSelectBoxTestId?: string
  /** Additional settings content rendered below the built-in settings */
  children?: React.ReactNode
}

/**
 * Available languages for the application
 */
const AVAILABLE_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français' }
]

/**
 * Settings page component
 * When SettingsProvider is available, renders the dynamic SettingsView.
 * Otherwise, falls back to the hardcoded theme + language UI.
 */
export const SettingsPage: React.FC<SettingsPageProps> = ({
  'data-testid': dataTestId,
  themeCarouselTestId,
  languageSelectBoxTestId,
  children
}) => {
  const { i18n } = useTranslation()
  const rootTestId = dataTestId ?? 'settings-page'
  const settingsCtx = useContext(SettingsContext)

  // If SettingsProvider is present and has groups, use SettingsView
  if (settingsCtx && settingsCtx.groups.length > 0) {
    return (
      <div className="settings-page" data-testid={rootTestId} data-language={i18n.language}>
        <SettingsView data-testid={`${rootTestId}-settings-view`} />
        {children}
      </div>
    )
  }

  // Fallback: hardcoded theme + language
  const carouselTestId = themeCarouselTestId ?? `${rootTestId}-theme-carousel`
  const languageTestId = languageSelectBoxTestId ?? `${rootTestId}-language-selectbox`

  return (
    <SettingsPageFallback
      rootTestId={rootTestId}
      carouselTestId={carouselTestId}
      languageTestId={languageTestId}
      language={i18n.language}
    >
      {children}
    </SettingsPageFallback>
  )
}

interface SettingsPageFallbackProps {
  rootTestId: string
  carouselTestId: string
  languageTestId: string
  language: string
  children?: React.ReactNode
}

const SettingsPageFallback: React.FC<SettingsPageFallbackProps> = ({
  rootTestId,
  carouselTestId,
  languageTestId,
  language,
  children
}) => {
  const { t, i18n } = useTranslation()

  const languageOptions = useMemo(() => {
    return AVAILABLE_LANGUAGES.map(lang => ({
      text: lang.name,
      detail: lang.code.toUpperCase()
    }))
  }, [])

  const currentLanguageIndex = useMemo(() => {
    const index = AVAILABLE_LANGUAGES.findIndex(lang => lang.code === i18n.language)
    return index >= 0 ? index : 0
  }, [i18n.language])

  const handleLanguageChange = (data: ISelectData): void => {
    const selectedLanguage = AVAILABLE_LANGUAGES[data.index]
    if (selectedLanguage) {
      void i18n.changeLanguage(selectedLanguage.code)
      void window.api.i18n.setLanguage(selectedLanguage.code)
    }
  }

  return (
    <div className="settings-page" data-testid={rootTestId} data-language={language}>
      <div className="settings-section">
        <div className="settings-item">
          <h1 className="settings-label">
            {t('settings.theme', 'Theme')}
          </h1>
          <ThemeCarousel data-testid={carouselTestId} />
        </div>

        <div className="settings-item">
          <h1 className="settings-label">
            {t('settings.language', 'Language')}
          </h1>
          <SelectBox
            data-testid={languageTestId}
            id="language-select"
            className="settings-select"
            options={languageOptions}
            selected={currentLanguageIndex}
            onDidSelect={handleLanguageChange}
          />
        </div>
        {children}
      </div>
    </div>
  )
}

export default SettingsPage
