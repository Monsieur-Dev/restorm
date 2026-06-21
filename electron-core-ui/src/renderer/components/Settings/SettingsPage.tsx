import React, { useContext, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SelectBox } from '../SelectBox'
import { Tooltip } from '../Tooltip'
import type { ISelectData } from '../SelectBox/types'
import { ThemeCarousel } from './ThemeCarousel'
import { SettingsView } from './SettingsView'
import { SettingsContext } from '../../contexts/settingsContextDef'
import type { SettingsScope } from '../../contexts/settingsContextDef'
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
 * Available languages for the application. Each entry's `name` is the
 * endonym (the language's name in its own tongue) so the dropdown
 * always reads natively for the user picking from it.
 */
const AVAILABLE_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français' },
  { code: 'es', name: 'Español' },
  { code: 'de', name: 'Deutsch' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Português' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'sv', name: 'Svenska' },
  { code: 'da', name: 'Dansk' },
  { code: 'nb', name: 'Norsk bokmål' },
  { code: 'fi', name: 'Suomi' },
  { code: 'pl', name: 'Polski' },
  { code: 'cs', name: 'Čeština' },
  { code: 'hu', name: 'Magyar' },
  { code: 'ro', name: 'Română' },
  { code: 'el', name: 'Ελληνικά' },
  { code: 'uk', name: 'Українська' },
  { code: 'hr', name: 'Hrvatski' },
  { code: 'sr', name: 'Srpski' },
  { code: 'sq', name: 'Shqip' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'zh-CN', name: '简体中文' },
  { code: 'zh-TW', name: '繁體中文' }
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
      <SettingsPageBody
        rootTestId={rootTestId}
        language={i18n.language}
        workspacePath={settingsCtx.workspacePath}
      >
        {children}
      </SettingsPageBody>
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

/**
 * Two-tab body when a SettingsProvider is active — User on the left
 * (default), Workspace on the right (disabled when no project is
 * open). Tabs share the same SettingsView but with a `scope` prop so
 * reads / writes route to the right layer.
 */
interface SettingsPageBodyProps {
  rootTestId: string
  language: string
  workspacePath: string | null
  children?: React.ReactNode
}

const SettingsPageBody: React.FC<SettingsPageBodyProps> = ({
  rootTestId,
  language,
  workspacePath,
  children
}) => {
  const { t } = useTranslation()
  const [scope, setScope] = useState<SettingsScope>('user')
  const workspaceDisabled = workspacePath === null
  const [showWorkspaceTooltip, setShowWorkspaceTooltip] = useState(false)
  const workspaceTabRef = useRef<HTMLButtonElement>(null)
  // If the workspace closes while the Workspace tab is active, fall
  // back to User so the user isn't stuck on a disabled tab.
  React.useEffect(() => {
    if (workspaceDisabled && scope === 'workspace') setScope('user')
  }, [workspaceDisabled, scope])

  const tabClass = (s: SettingsScope, disabled: boolean): string => [
    'settings-page-tab',
    s === scope ? 'settings-page-tab--active' : '',
    disabled ? 'settings-page-tab--disabled' : ''
  ].filter(Boolean).join(' ')

  return (
    <div className="settings-page" data-testid={rootTestId} data-language={language} data-scope={scope}>
      <div className="settings-page-tabs" role="tablist" aria-label={t('settings.scopeTabsLabel', 'Settings scope')}>
        <button
          type="button"
          role="tab"
          aria-selected={scope === 'user'}
          className={tabClass('user', false)}
          data-testid={`${rootTestId}-tab-user`}
          onClick={() => { setScope('user') }}
        >
          {t('settings.scope.user', 'User')}
        </button>
        <button
          ref={workspaceTabRef}
          type="button"
          role="tab"
          aria-selected={scope === 'workspace'}
          aria-disabled={workspaceDisabled}
          disabled={workspaceDisabled}
          className={tabClass('workspace', workspaceDisabled)}
          data-testid={`${rootTestId}-tab-workspace`}
          aria-label={workspacePath ?? t('settings.scope.workspaceDisabledTooltip', 'Open a project to edit workspace settings')}
          onMouseEnter={() => { setShowWorkspaceTooltip(true) }}
          onMouseLeave={() => { setShowWorkspaceTooltip(false) }}
          onClick={() => { if (!workspaceDisabled) setScope('workspace') }}
        >
          {t('settings.scope.workspace', 'Workspace')}
        </button>
        <Tooltip
          targetRef={workspaceTabRef}
          content={workspacePath ?? t('settings.scope.workspaceDisabledTooltip', 'Open a project to edit workspace settings')}
          show={showWorkspaceTooltip}
          placement="below"
        />
      </div>
      <SettingsView data-testid={`${rootTestId}-settings-view`} scope={scope} />
      {children}
    </div>
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
