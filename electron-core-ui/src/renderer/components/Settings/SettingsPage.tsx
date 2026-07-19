import React, { useContext, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tabs, type Tab } from '../Tabs'
import { SelectBox } from '../SelectBox'
import { Tooltip } from '../Tooltip'
import type { ISelectData } from '../SelectBox/types'
import { ThemeCarousel } from './ThemeCarousel'
import { SettingsView } from './SettingsView'
import { SettingsContext } from '../../contexts/settingsContextDef'
import type { SettingsScope } from '../../contexts/settingsContextDef'
import { AVAILABLE_LANGUAGES } from './languages'
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
  const workspaceTabLabelRef = useRef<HTMLSpanElement>(null)
  // If the workspace closes while the Workspace tab is active, fall
  // back to User so the user isn't stuck on a disabled tab.
  React.useEffect(() => {
    if (workspaceDisabled && scope === 'workspace') setScope('user')
  }, [workspaceDisabled, scope])

  const settingsTabs: Tab[] = [
    {
      id: 'user',
      label: (
        <span data-testid={`${rootTestId}-tab-user`}>
          {t('settings.scope.user', 'User')}
        </span>
      ),
      useScrollableElement: false,
      content: (
        <>
          <SettingsView data-testid={`${rootTestId}-settings-view`} scope="user" />
          {children}
        </>
      )
    },
    {
      id: 'workspace',
      label: (
        <span
          ref={workspaceTabLabelRef}
          data-testid={`${rootTestId}-tab-workspace`}
          style={workspaceDisabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          onMouseEnter={() => { setShowWorkspaceTooltip(true) }}
          onMouseLeave={() => { setShowWorkspaceTooltip(false) }}
        >
          {t('settings.scope.workspace', 'Workspace')}
        </span>
      ),
      useScrollableElement: false,
      content: (
        <>
          <SettingsView data-testid={`${rootTestId}-settings-view`} scope="workspace" />
          {children}
        </>
      )
    }
  ]

  return (
    <div className="settings-page" data-testid={rootTestId} data-language={language} data-scope={scope}>
      <Tabs
        tabs={settingsTabs}
        activeTabId={scope}
        onTabChange={(id) => {
          if (id === 'workspace' && workspaceDisabled) return
          setScope(id as SettingsScope)
        }}
        mountStrategy="active-only"
      />
      <Tooltip
        targetRef={workspaceTabLabelRef}
        content={workspacePath ?? t('settings.scope.workspaceDisabledTooltip', 'Open a project to edit workspace settings')}
        show={showWorkspaceTooltip}
        placement="below"
      />
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
      text: `${lang.flag} ${lang.name}`
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
