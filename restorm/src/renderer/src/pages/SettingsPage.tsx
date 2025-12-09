import React, { useState } from 'react'
import { useTheme, CustomDropdown, logger, InputBox, MessageType, Toggle, RadioGroup, ScrollableElement, Statusbar, StatusbarElement } from 'electron-core-ui/renderer'
import type { IInputValidator } from 'electron-core-ui/renderer'

interface Theme {
  id: string;
  name: string;
  type: string;
}

const SettingsPage: React.FC = () => {
  const { themes, currentThemeId, setTheme, isLoading } = useTheme()
  
  const [editorSettings, setEditorSettings] = useState({
    fontSize: '14',
    fontFamily: 'Consolas',
    tabSize: '4',
    wordWrap: true,
    minimap: true,
    lineNumbers: true,
    autoSave: true,
    formatOnSave: false
  })
  const [appearanceSettings, setAppearanceSettings] = useState({
    theme: currentThemeId ?? '',
    sidebarLocation: 'left',
    panelLocation: 'bottom',
    statusBar: true,
    activityBar: true
  })
  const [advancedSettings, setAdvancedSettings] = useState({
    telemetry: false,
    crashReports: true,
    updateChannel: 'stable',
    experimentalFeatures: false
  })

  const handleThemeChange = (value: string): void => {
    void setTheme(value).catch((err: unknown) => {
      logger.error('Failed to change theme', { error: String(err) })
    })
    setAppearanceSettings(prev => ({ ...prev, theme: value }))
  }

  const themeOptions = (themes as Theme[]).map(theme => ({
    value: theme.id,
    label: `${theme.name} (${theme.type})`
  }))

  // Validators
  const fontSizeValidator: IInputValidator = (value: string) => {
    const num = parseInt(value, 10)
    if (isNaN(num) || num < 8 || num > 72) {
      return { content: 'Font size must be between 8 and 72', type: MessageType.ERROR }
    }
    return null
  }

  const tabSizeValidator: IInputValidator = (value: string) => {
    const num = parseInt(value, 10)
    if (isNaN(num) || num < 1 || num > 8) {
      return { content: 'Tab size must be between 1 and 8', type: MessageType.ERROR }
    }
    return null
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        height: '100vh',
        backgroundColor: 'var(--ecui-editor-background)',
        color: 'var(--ecui-editor-foreground)'
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '20px',
          borderBottom: '1px solid var(--ecui-panel-border)',
          backgroundColor: 'var(--ecui-sideBar-background)'
        }}
      >
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <h1 style={{ margin: '0 0 10px 0', fontSize: '24px' }}>
            Settings
          </h1>
          <p
            style={{
              margin: '0 0 15px 0',
              color: 'var(--ecui-descriptionForeground)',
              fontSize: '14px'
            }}
          >
            Configure your application preferences
          </p>
        </div>
      </div>

      {/* Settings Content with ScrollableElement */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <ScrollableElement
          options={{ vertical: 'auto', horizontal: 'hidden', useShadows: true }}
          style={{ flex: 1, width: '100%' }}
        >
          <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '20px' }}>
            
            {/* Editor Settings */}
            <div style={{ marginBottom: '40px' }}>
              <h2 style={{ fontSize: '18px', marginBottom: '20px', color: 'var(--ecui-foreground)' }}>
                Editor Settings
              </h2>
              
              <div style={{ display: 'grid', gap: '20px', maxWidth: '600px' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 'bold' }}>
                    Font Size
                  </label>
                  <InputBox
                    value={editorSettings.fontSize}
                    onChange={(value) => { setEditorSettings(prev => ({ ...prev, fontSize: value })) }}
                    options={{
                      placeholder: "Font size",
                      validationOptions: { validation: fontSizeValidator },
                      type: "number"
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 'bold' }}>
                    Font Family
                  </label>
                  <InputBox
                    value={editorSettings.fontFamily}
                    onChange={(value) => { setEditorSettings(prev => ({ ...prev, fontFamily: value })) }}
                    options={{
                      placeholder: "Font family"
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 'bold' }}>
                    Tab Size
                  </label>
                  <InputBox
                    value={editorSettings.tabSize}
                    onChange={(value) => { setEditorSettings(prev => ({ ...prev, tabSize: value })) }}
                    options={{
                      placeholder: "Tab size",
                      validationOptions: { validation: tabSizeValidator },
                      type: "number"
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' }}>
                    <Toggle
                      isChecked={editorSettings.wordWrap}
                      onChange={(checked: boolean) => { setEditorSettings(prev => ({ ...prev, wordWrap: checked })) }}
                    />
                    Word Wrap
                  </label>
                </div>

                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' }}>
                    <Toggle
                      isChecked={editorSettings.minimap}
                      onChange={(checked: boolean) => { setEditorSettings(prev => ({ ...prev, minimap: checked })) }}
                    />
                    Show Minimap
                  </label>
                </div>

                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' }}>
                    <Toggle
                      isChecked={editorSettings.lineNumbers}
                      onChange={(checked: boolean) => { setEditorSettings(prev => ({ ...prev, lineNumbers: checked })) }}
                    />
                    Line Numbers
                  </label>
                </div>

                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' }}>
                    <Toggle
                      isChecked={editorSettings.autoSave}
                      onChange={(checked: boolean) => { setEditorSettings(prev => ({ ...prev, autoSave: checked })) }}
                    />
                    Auto Save
                  </label>
                </div>

                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' }}>
                    <Toggle
                      isChecked={editorSettings.formatOnSave}
                      onChange={(checked: boolean) => { setEditorSettings(prev => ({ ...prev, formatOnSave: checked })) }}
                    />
                    Format on Save
                  </label>
                </div>
              </div>
            </div>

            {/* Appearance Settings */}
            <div style={{ marginBottom: '40px' }}>
              <h2 style={{ fontSize: '18px', marginBottom: '20px', color: 'var(--ecui-foreground)' }}>
                Appearance
              </h2>
              
              <div style={{ display: 'grid', gap: '20px', maxWidth: '600px' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 'bold' }}>
                    Color Theme
                  </label>
                  <CustomDropdown
                    value={appearanceSettings.theme}
                    options={themeOptions}
                    onChange={handleThemeChange}
                    disabled={isLoading}
                    placeholder="Select theme"
                  />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 'bold' }}>
                    Sidebar Location
                  </label>
                  <RadioGroup
                    options={{
                      items: [
                        { text: 'Left', isActive: appearanceSettings.sidebarLocation === 'left' },
                        { text: 'Right', isActive: appearanceSettings.sidebarLocation === 'right' }
                      ]
                    }}
                    onSelect={(index: number) => { 
                      const value = index === 0 ? 'left' : 'right'
                      setAppearanceSettings(prev => ({ ...prev, sidebarLocation: value }))
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 'bold' }}>
                    Panel Location
                  </label>
                  <RadioGroup
                    options={{
                      items: [
                        { text: 'Bottom', isActive: appearanceSettings.panelLocation === 'bottom' },
                        { text: 'Right', isActive: appearanceSettings.panelLocation === 'right' }
                      ]
                    }}
                    onSelect={(index: number) => { 
                      const value = index === 0 ? 'bottom' : 'right'
                      setAppearanceSettings(prev => ({ ...prev, panelLocation: value }))
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' }}>
                    <Toggle
                      isChecked={appearanceSettings.statusBar}
                      onChange={(checked: boolean) => { setAppearanceSettings(prev => ({ ...prev, statusBar: checked })) }}
                    />
                    Show Status Bar
                  </label>
                </div>

                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' }}>
                    <Toggle
                      isChecked={appearanceSettings.activityBar}
                      onChange={(checked: boolean) => { setAppearanceSettings(prev => ({ ...prev, activityBar: checked })) }}
                    />
                    Show Activity Bar
                  </label>
                </div>
              </div>
            </div>

            {/* Advanced Settings */}
            <div style={{ marginBottom: '40px' }}>
              <h2 style={{ fontSize: '18px', marginBottom: '20px', color: 'var(--ecui-foreground)' }}>
                Advanced
              </h2>
              
              <div style={{ display: 'grid', gap: '20px', maxWidth: '600px' }}>
                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' }}>
                    <Toggle
                      isChecked={advancedSettings.telemetry}
                      onChange={(checked: boolean) => { setAdvancedSettings(prev => ({ ...prev, telemetry: checked })) }}
                    />
                    Enable Telemetry
                  </label>
                </div>

                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' }}>
                    <Toggle
                      isChecked={advancedSettings.crashReports}
                      onChange={(checked: boolean) => { setAdvancedSettings(prev => ({ ...prev, crashReports: checked })) }}
                    />
                    Send Crash Reports
                  </label>
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 'bold' }}>
                    Update Channel
                  </label>
                  <RadioGroup
                    options={{
                      items: [
                        { text: 'Stable', isActive: advancedSettings.updateChannel === 'stable' },
                        { text: 'Beta', isActive: advancedSettings.updateChannel === 'beta' },
                        { text: 'Insider', isActive: advancedSettings.updateChannel === 'insider' }
                      ]
                    }}
                    onSelect={(index: number) => { 
                      const values = ['stable', 'beta', 'insider']
                      const value = values[index] ?? 'stable'
                      setAdvancedSettings(prev => ({ ...prev, updateChannel: value }))
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' }}>
                    <Toggle
                      isChecked={advancedSettings.experimentalFeatures}
                      onChange={(checked: boolean) => { setAdvancedSettings(prev => ({ ...prev, experimentalFeatures: checked })) }}
                    />
                    Enable Experimental Features
                  </label>
                </div>
              </div>
            </div>

            {/* Additional content to demonstrate scrolling */}
            <div style={{ marginBottom: '40px' }}>
              <h2 style={{ fontSize: '18px', marginBottom: '20px', color: 'var(--ecui-foreground)' }}>
                Additional Settings
              </h2>
              
              <div style={{ display: 'grid', gap: '20px', maxWidth: '600px' }}>
                <p style={{ color: 'var(--ecui-descriptionForeground)', fontSize: '14px' }}>
                  This section demonstrates the ScrollableElement component in a real settings page.
                  The content scrolls smoothly with VSCode-style scrollbars that auto-hide.
                </p>
                
                {Array.from({ length: 20 }, (_, i) => (
                  <div key={i} style={{ padding: '10px', border: '1px solid var(--ecui-panel-border)', borderRadius: '4px' }}>
                    <h4 style={{ margin: '0 0 8px 0', fontSize: '14px' }}>Setting {i + 1}</h4>
                    <p style={{ margin: '0', fontSize: '12px', color: 'var(--ecui-descriptionForeground)' }}>
                      This is a sample setting item to demonstrate scrolling behavior.
                    </p>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </ScrollableElement>
      </div>

      {/* Statusbar */}
      <Statusbar>
        <StatusbarElement title="Ready" />
        <StatusbarElement title="Settings" />
      </Statusbar>
    </div>
  )
}

export default SettingsPage
