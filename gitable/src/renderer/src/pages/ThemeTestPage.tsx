import React, { useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useTheme, CustomTabs, logger, SelectBox, Titlebar, MenuBar, MenuBarItem, MenuItem, MenuItemSeparator } from 'electron-vscodelike-core-ui/renderer'
import type { Tab } from 'electron-vscodelike-core-ui/renderer'
import '@vscode/codicons/dist/codicon.css'
import { 
  InputsTab, 
  CheckboxesTab, 
  ButtonsTab, 
  DropdownsTab, 
  PanelsTab, 
  TextTab, 
  ScrollbarsTab, 
  ProgressTab 
} from '../components/test-tabs'

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
  const currentThemeId: string | null = (currentThemeIdRaw === null || currentThemeIdRaw === undefined) 
    ? null 
    : (typeof currentThemeIdRaw === 'string' || typeof currentThemeIdRaw === 'number')
      ? String(currentThemeIdRaw)
      : null
  const setThemeRaw: unknown = result.setTheme
  const setTheme: (themeId: string) => Promise<void> = async (themeId: string): Promise<void> => {
    const setThemeFunc = setThemeRaw as (themeId: string) => Promise<unknown>
    await setThemeFunc(themeId)
  }
  return { themes, currentThemeId, setTheme }
}

function getThemeByIdHelper(themes: readonly SafeThemeInfo[], themeId: string): SafeThemeInfo | undefined {
  for (const themeItem of themes) {
    const themeIdValue = themeItem.id
    if (themeIdValue === themeId) {
      return themeItem
    }
  }
  return undefined
}

const ThemeTestPage: React.FC = () => {
  const { t } = useTranslation()
  const { themes, currentThemeId, setTheme } = useThemeTyped()

  // Helper function to safely access theme properties
  const getThemeById = useCallback((themeId: string | null): SafeThemeInfo | undefined => {
    if (themeId === null) return undefined
    return getThemeByIdHelper(themes, themeId)
  }, [themes])

  // Update window title when theme changes
  useEffect(() => {
    if (currentThemeId && typeof currentThemeId === 'string') {
      const currentTheme = getThemeById(currentThemeId)
      if (currentTheme) {
        const themeName = currentTheme.name
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
        const themeId = selectedTheme.id
        void setTheme(themeId).catch((err: unknown) => {
          logger.error('Failed to change theme', { error: String(err) })
        })
      }
    }
  }

  const themeOptions: ThemeOption[] = []
  for (const themeItem of themes) {
    const themeName = themeItem.name
    const themeType = themeItem.type
    const themeId = themeItem.id
    themeOptions.push({
      text: `${themeName} (${themeType})`,
      description: `Theme ID: ${themeId}`,
      isDisabled: false,
      id: themeId
    })
  }

  const tabs: Tab[] = [
    { id: 'checkboxes', label: 'Checkboxes & Radio', content: <CheckboxesTab /> },
    { id: 'dropdowns', label: 'Dropdowns', content: <DropdownsTab /> },
    { id: 'buttons', label: 'Buttons', content: <ButtonsTab /> },
    { id: 'scrollbars', label: 'Scrollbars', content: <ScrollbarsTab /> },
    { id: 'progressbars', label: 'Progress bars', content: <ProgressTab /> },
    { id: 'inputs', label: 'Text Inputs', content: <InputsTab /> },
    { id: 'panels', label: 'Panels & Lists', content: <PanelsTab /> },
    { id: 'text', label: 'Text Styles', content: <TextTab /> }
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
                  title={`Test Item ${String(index + 1)}`} 
                  onClick={() => { logger.info(`Clicked test item ${String(index + 1)}`) }} 
                />
              ))}
            </MenuItem>
          </MenuBarItem>
          </MenuBar>
        }
        rightContent={
          <button 
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--vscode-titleBar-activeForeground)',
              cursor: 'pointer',
              padding: '4px 8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            onClick={() => { logger.info('Settings button clicked') }}
          >
            <i className="codicon codicon-gear"></i>
          </button>
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
          
          {/* Theme Selector */}
          <div style={{ maxWidth: '400px' }}>
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
        </div>
      </div>

      {/* Tabs */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <CustomTabs tabs={tabs} />
      </div>
    </div>
  )
}

export default ThemeTestPage

