import React from 'react'
import { useTranslation } from 'react-i18next'
import { useTheme, CustomTabs, logger, SelectBox } from 'electron-vscodelike-core-ui/renderer'
import type { Tab } from 'electron-vscodelike-core-ui/renderer'
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

interface Theme {
  id: string;
  name: string;
  type: string;
}

const ThemeTestPage: React.FC = () => {
  const { t } = useTranslation()
  const { themes, currentThemeId, setTheme } = useTheme()

  const handleThemeChange = (data: { selected: string; index: number }): void => {
    logger.info('handleThemeChange', { data })
    // data.index contains the index, so we need to get the theme by index
    const selectedTheme = (themes as Theme[])[data.index]
    if (selectedTheme) {
      void setTheme(selectedTheme.id).catch((err: unknown) => {
        logger.error('Failed to change theme', { error: String(err) })
      })
    }
  }

  const themeOptions = (themes as Theme[]).map(theme => ({
    text: `${theme.name} (${theme.type})`,
    description: `Theme ID: ${theme.id}`,
    isDisabled: false
  }))

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
              selected={themeOptions.findIndex(option => option.text.includes(currentThemeId ?? ''))}
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
