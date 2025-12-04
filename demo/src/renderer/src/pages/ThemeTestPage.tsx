import React, { useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useTheme, Tabs, logger, SelectBox, Titlebar, MenuBar, MenuBarItem, MenuItem, MenuItemSeparator, Button, Statusbar, StatusbarElement } from 'electron-core-ui/renderer'
import type { Tab } from 'electron-core-ui/renderer'
import '@vscode/codicons/dist/codicon.css'
import { 
  InputsTab, 
  CheckboxesTab, 
  ButtonsTab, 
  DropdownsTab, 
  PanelsTab, 
  TextTab, 
  ScrollbarsTab, 
  ProgressTab,
  StickHeadersTab,
  SplitViewTab
} from '../components/test-tabs'
import { WorkbenchTab } from '../components/test-tabs'

interface ThemeOption {
  text: string
  description: string
  isDisabled: boolean
  id: string
}

// Local interface to ensure proper type resolution
interface SafeThemeInfo {
  id: string
  name: string
  type: 'dark' | 'light' | 'hc' | 'hcLight'
  path: string
}

// Type-safe wrapper for useTheme hook
function useThemeTyped(): {
  themes: SafeThemeInfo[]
  currentThemeId: string | null
  setTheme: (themeId: string) => Promise<void>
} {
  const resultUnknown: unknown = useTheme()
  const result = resultUnknown as { themes: unknown; currentThemeId: unknown; setTheme: unknown }
  const themesRaw: unknown = result.themes
  const themesArray: unknown[] = Array.isArray(themesRaw) ? themesRaw : []
  const themes: SafeThemeInfo[] = themesArray as SafeThemeInfo[]
  const currentThemeIdRaw: unknown = result.currentThemeId
  const currentThemeId: string | null = (currentThemeIdRaw === null || currentThemeIdRaw === undefined) ? null : String(currentThemeIdRaw)
  const setThemeRaw: unknown = result.setTheme
  const setTheme: (themeId: string) => Promise<void> = async (themeId: string): Promise<void> => {
    const setThemeFunc = setThemeRaw as (themeId: string) => Promise<unknown>
    await setThemeFunc(themeId)
  }
  return { themes, currentThemeId, setTheme }
}

function getThemeByIdHelper(themes: readonly SafeThemeInfo[], themeId: string): SafeThemeInfo | undefined {
  for (const themeItem of themes) {
    const themeIdValue = String(themeItem.id)
    if (themeIdValue === themeId) {
      return themeItem
    }
  }
  return undefined
}

const ThemeTestPage: React.FC = () => {
  const { t, i18n } = useTranslation()
  const { themes, currentThemeId, setTheme } = useThemeTyped()

  // Helper function to safely access theme properties
  const getThemeById = useCallback((themeId: string | null): SafeThemeInfo | undefined => {
    if (themeId === null) return undefined
    return getThemeByIdHelper(themes, themeId)
  }, [themes])

  // Handle language change
  const handleLanguageChange = (): void => {
    const newLang = i18n.language === 'en' ? 'fr' : 'en'
    void i18n.changeLanguage(newLang).catch((error: unknown) => {
      logger.error('Failed to change language', { error: String(error) })
    })
  }

  // Update window title when theme changes
  useEffect(() => {
    if (currentThemeId && typeof currentThemeId === 'string') {
      const currentTheme = getThemeById(currentThemeId)
      if (currentTheme) {
        const themeName = String(currentTheme.name)
        const windowTitle = `${t('app.title')} - ${themeName}`
        void window.api.setWindowTitle(windowTitle)
      }
    } else {
      void window.api.setWindowTitle(t('app.title'))
    }
  }, [currentThemeId, getThemeById, t])

  const handleToggleDeveloperTools = async (): Promise<void> => {
    await window.api.toggleDeveloperTools()
    logger.info('Toggle Developer Tools')
  }

  const handleThemeChange = (data: { selected: string; index: number }): void => {
    logger.info('handleThemeChange', { data })
    const index = data.index
    if (typeof index === 'number' && index >= 0 && index < themes.length) {
      const selectedTheme = themes[index]
      if (selectedTheme) {
        const themeId = String(selectedTheme.id)
        void setTheme(themeId).catch((err: unknown) => {
          logger.error('Failed to change theme', { error: String(err) })
        })
      }
    }
  }

  const themeOptions: ThemeOption[] = []
  for (const themeItem of themes) {
    const themeName = String(themeItem.name)
    const themeType = String(themeItem.type)
    const themeId = String(themeItem.id)
    themeOptions.push({
      text: `${themeName} (${themeType})`,
      description: `Theme ID: ${themeId}`,
      isDisabled: false,
      id: themeId
    })
  }

  const tabs: Tab[] = [
    { id: 'split-view', label: 'SplitView', content: <SplitViewTab /> },
    { id: 'sticky-headers', label: t('themeTest.components.stickyHeaders'), content: <StickHeadersTab /> },
    { id: 'workbench', label: 'Workbench', content: <WorkbenchTab /> },
    { id: 'checkboxes', label: 'Checkboxes & Radio', content: <CheckboxesTab /> },
    { id: 'dropdowns', label: 'Dropdowns', content: <DropdownsTab /> },
    { id: 'buttons', label: 'Buttons', content: <ButtonsTab /> },
    { id: 'scrollbars', label: 'Scrollbars', content: <ScrollbarsTab /> },
    { id: 'progressbars', label: 'Progress bars', content: <ProgressTab /> },
    { id: 'inputs', label: 'Text Inputs', content: <InputsTab /> },
    { id: 'panels', label: 'Panels & Lists', content: <PanelsTab /> },
    { id: 'text', label: 'Text Styles', content: <TextTab /> },
  ]

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        height: '100vh',
        backgroundColor: 'var(--vscode-editor-background)',
        color: 'var(--vscode-editor-foreground)'
      }}
    >
      {/* Titlebar with MenuBar */}
      <Titlebar 
        title={t('app.title')}
        leftContent={
          <MenuBar>
          <MenuBarItem title={t('menuBar.file')}>
            <MenuItem 
              title={t('menuBar.new')} 
              shortcut="Ctrl+N" 
              onClick={() => { logger.info('New file') }} 
            />
            <MenuItem 
              title={t('menuBar.open')} 
              shortcut="Ctrl+O" 
              onClick={() => { logger.info('Open file') }} 
            />
            <MenuItem title={t('menuBar.openRecent')}>
              <MenuItem 
                title="File 1" 
                onClick={() => { logger.info('Recent file 1') }} 
              />
              <MenuItem 
                title="File 2" 
                onClick={() => { logger.info('Recent file 2') }} 
              />
              <MenuItem 
                title="File 3" 
                onClick={() => { logger.info('Recent file 3') }} 
              />
            </MenuItem>
            <MenuItemSeparator />
            <MenuItem 
              title={t('menuBar.editor')} 
              onClick={() => { 
                logger.info('Opening editor window with notes.txt')
                void window.demo.openEditor({ title: 'notes.txt', content: 'test content' })
              }} 
            />
            <MenuItemSeparator />
            <MenuItem 
              title={t('menuBar.save')} 
              shortcut="Ctrl+S" 
              onClick={() => { logger.info('Save file') }} 
            />
            <MenuItemSeparator />
            <MenuItem 
              title={t('menuBar.autoSave')} 
              checked 
              onClick={() => { logger.info('Auto-save') }} 
            />
            <MenuItemSeparator />
            <MenuItem 
              title={t('menuBar.revert')} 
              disabled 
              onClick={() => { logger.info('Revert file') }} 
            />
          </MenuBarItem>
          <MenuBarItem title={t('menuBar.edit')}>
            <MenuItem 
              title={t('menuBar.undo')} 
              shortcut="Ctrl+Z" 
              onClick={() => { logger.info('Undo') }} 
            />
            <MenuItem 
              title={t('menuBar.redo')} 
              shortcut="Ctrl+Y" 
              onClick={() => { logger.info('Redo') }} 
            />
          </MenuBarItem>
          <MenuBarItem title={t('menuBar.view')}>
            <MenuItem 
              title={t('menuBar.toggleDeveloperTools')} 
              shortcut="F12" 
              onClick={() => { void handleToggleDeveloperTools() }} 
            />
            <MenuItemSeparator />
            <MenuItem title="Test Submenu (100 items)">
              {Array.from({ length: 100 }, (_, index) => (
                <MenuItem 
                  key={index}
                  title={`Test Item ${index + 1}`} 
                  onClick={() => { logger.info(`Clicked test item ${index + 1}`) }} 
                />
              ))}
            </MenuItem>
          </MenuBarItem>
          </MenuBar>
        }
        rightContent={
          <Button
            small secondary
            onClick={() => { logger.info('Settings button clicked') }}
            options={{
              ariaLabel: 'Open settings',
              title: 'Open settings'
            }}
          >
            <i className="codicon codicon-gear"></i>
          </Button>
        }
      />

      {/* Header with theme selector */}
      <div
        style={{
          padding: '20px',
          borderBottom: '1px solid var(--vscode-panel-border)',
          backgroundColor: 'var(--vscode-sideBar-background)'
        }}
      >
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <h1 style={{ margin: '0 0 10px 0', fontSize: '24px' }}>
            {t('themeTest.title')}
          </h1>
          <p
            style={{
              margin: '0 0 15px 0',
              color: 'var(--vscode-descriptionForeground)',
              fontSize: '14px'
            }}
          >
            {t('themeTest.description')}
          </p>
          
          {/* Theme Selector and Language Button */}
          <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            {/* Theme Selector */}
            <div style={{ maxWidth: '400px', flex: '1 1 auto' }}>
              <label
                htmlFor="theme-selector"
                style={{
                  display: 'block',
                  marginBottom: '8px',
                  fontWeight: 'bold',
                  fontSize: '13px'
                }}
              >
                {t('themeTest.selectTheme')}
              </label>
              <SelectBox
                options={themeOptions}
                selected={currentThemeId ? themeOptions.findIndex((option: ThemeOption) => option.id === currentThemeId) : -1}
                onDidSelect={handleThemeChange}
                selectBoxOptions={{ 
                  useCustomDrawn: true,
                  ariaLabel: t('themeTest.selectTheme')
                }}
                id="theme-selector"
                className=""
              />
            </div>
            
            {/* Language Button */}
            <div style={{ flex: '0 0 auto' }}>
              <label
                htmlFor="language-button"
                style={{
                  display: 'block',
                  marginBottom: '8px',
                  fontWeight: 'bold',
                  fontSize: '13px'
                }}
              >
                {t('themeTest.language')}
              </label>
              <Button
                onClick={handleLanguageChange}
                options={{
                  ariaLabel: i18n.language === 'en' ? 'Switch to French' : 'Passer à l\'anglais',
                  title: i18n.language === 'en' ? 'Switch to French' : 'Passer à l\'anglais'
                }}
                id="language-button"
              >
                {i18n.language === 'en' ? 'Français' : 'English'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Tabs tabs={tabs} />
      </div>

      {/* Statusbar */}
      <Statusbar>
        <StatusbarElement title="Ready" />
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

export default ThemeTestPage

