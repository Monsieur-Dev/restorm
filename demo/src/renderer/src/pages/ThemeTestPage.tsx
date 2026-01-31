import React, { useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useTheme, Tabs, logger, SelectBox, Titlebar, MenuBar, MenuBarItem, MenuItem, MenuItemSeparator, Button, Statusbar, StatusbarElement, useSettingsModal } from 'electron-core-ui/renderer'
import type { Tab } from 'electron-core-ui/renderer'
import '@vscode/codicons/dist/codicon.css'
import { 
  InputsTab, 
  CheckboxesTab, 
  ButtonsTab, 
  ButtonHarnessTab,
  DropdownsTab, 
  PanelsTab, 
  TextTab, 
  ScrollbarsTab, 
  ProgressTab,
  StickHeadersTab,
  SplitViewTab,
  BreadcrumbTab,
  CalloutTab,
  ColorPickerTab,
  ContextMenuTab,
  CustomWcoTab,
  CodeEditorTab,
  InputBoxTab
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
  const currentThemeId: string | null = (typeof currentThemeIdRaw === 'string') ? currentThemeIdRaw : null
  const setThemeRaw: unknown = result.setTheme
  const setTheme: (themeId: string) => Promise<void> = async (themeId: string): Promise<void> => {
    const setThemeFunc = setThemeRaw as (themeId: string) => Promise<unknown>
    await setThemeFunc(themeId)
  }
  return { themes, currentThemeId, setTheme }
}

function getThemeByIdHelper(themes: readonly SafeThemeInfo[], themeId: string): SafeThemeInfo | undefined {
  for (const themeItem of themes) {
    if (themeItem.id === themeId) {
      return themeItem
    }
  }
  return undefined
}

const ThemeTestPage: React.FC = () => {
  const { t, i18n } = useTranslation()
  const { themes, currentThemeId, setTheme } = useThemeTyped()
  const { showSettingsModal } = useSettingsModal()

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
        const windowTitle = `${t('app.title')} - ${currentTheme.name}`
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
        void setTheme(selectedTheme.id).catch((err: unknown) => {
          logger.error('Failed to change theme', { error: String(err) })
        })
      }
    }
  }

  const themeOptions: ThemeOption[] = []
  for (const themeItem of themes) {
    themeOptions.push({
      text: `${themeItem.name} (${themeItem.type})`,
      description: `Theme ID: ${themeItem.id}`,
      isDisabled: false,
      id: themeItem.id
    })
  }

  const tabs: Tab[] = [
    { id: 'workbench', label: 'Workbench', content: <WorkbenchTab />, allowFullscreen: true },
    { id: 'breadcrumb', label: 'Breadcrumb', content: <BreadcrumbTab />, allowFullscreen: true },
    { id: 'button', label: 'Button', content: <ButtonHarnessTab />, allowFullscreen: true },
    { id: 'callout', label: t('callout.tabLabel'), content: <CalloutTab />, allowFullscreen: true },
    { id: 'colorpicker', label: t('colorPicker.tabLabel'), content: <ColorPickerTab />, allowFullscreen: true },
    { id: 'contextmenu', label: t('contextMenu.tabLabel'), content: <ContextMenuTab />, allowFullscreen: true },
    { id: 'customwco', label: t('customWco.tabLabel'), content: <CustomWcoTab />, allowFullscreen: true },
    { id: 'codeeditor', label: t('codeEditor.tabLabel'), content: <CodeEditorTab />, allowFullscreen: true },
    { id: 'inputbox', label: t('inputBox.tabLabel'), content: <InputBoxTab />, allowFullscreen: true },
    { id: 'sticky-headers', label: t('themeTest.components.stickyHeaders'), content: <StickHeadersTab />, allowFullscreen: true },
    { id: 'split-view', label: 'SplitView', content: <SplitViewTab />, allowFullscreen: true },
    { id: 'checkboxes', label: 'Checkboxes & Radio', content: <CheckboxesTab />, allowFullscreen: true },
    { id: 'dropdowns', label: 'Dropdowns', content: <DropdownsTab />, allowFullscreen: true },
    { id: 'buttons', label: 'Buttons', content: <ButtonsTab />, allowFullscreen: true },
    { id: 'scrollbars', label: 'Scrollbars', content: <ScrollbarsTab />, allowFullscreen: true },
    { id: 'progressbars', label: 'Progress bars', content: <ProgressTab />, allowFullscreen: true },
    { id: 'inputs', label: 'Text Inputs', content: <InputsTab />, allowFullscreen: true },
    { id: 'panels', label: 'Panels & Lists', content: <PanelsTab />, allowFullscreen: true },
    { id: 'text', label: 'Text Styles', content: <TextTab />, allowFullscreen: true },
  ]

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        height: '100vh',
        backgroundColor: 'var(--editor-background)',
        color: 'var(--editor-foreground)'
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
            onClick={() => { showSettingsModal() }}
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
          borderBottom: '1px solid var(--panel-border)',
          backgroundColor: 'var(--sideBar-background)'
        }}
      >
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <h1 style={{ margin: '0 0 10px 0', fontSize: '24px' }}>
            {t('themeTest.title')}
          </h1>
          <p
            style={{
              margin: '0 0 15px 0',
              color: 'var(--descriptionForeground)',
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
