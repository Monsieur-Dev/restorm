import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useTheme, CustomDropdown, CustomTabs, logger, InputBox, MessageType, Toggle, RadioGroup, ProgressBar, ScrollableElement, Button, ButtonWithDescription, ButtonWithDropdown, ButtonWithIcon } from 'electron-vscodelike-core-ui/renderer'
import type { Tab, IInputValidator } from 'electron-vscodelike-core-ui/renderer'

interface Theme {
  id: string;
  name: string;
  type: string;
}

const ThemeTestPage: React.FC = () => {
  const { t } = useTranslation()
  const { themes, currentThemeId, setTheme, isLoading } = useTheme()
  const [textInput, setTextInput] = useState('Sample text')
  const [numberInput, setNumberInput] = useState('42')
  const [emailInput, setEmailInput] = useState('')
  const [passwordInput, setPasswordInput] = useState('')
  const [usernameInput, setUsernameInput] = useState('')
  const [toggleChecked, setToggleChecked] = useState(true)
  const [toggleUnchecked, setToggleUnchecked] = useState(false)
  const [toggleDisabled, setToggleDisabled] = useState(false)
  const [radioValue, setRadioValue] = useState('option1')
  const [selectValue, setSelectValue] = useState('option1')
  const [textareaValue, setTextareaValue] = useState(`Line 1: Lorem ipsum dolor sit amet
Line 2: Consectetur adipiscing elit
Line 3: Sed do eiusmod tempor incididunt
Line 4: Ut labore et dolore magna aliqua
Line 5: Ut enim ad minim veniam
Line 6: Quis nostrud exercitation ullamco
Line 7: Laboris nisi ut aliquip ex ea
Line 8: Commodo consequat duis aute
Line 9: Irure dolor in reprehenderit
Line 10: In voluptate velit esse cillum
Line 11: Dolore eu fugiat nulla pariatur
Line 12: Excepteur sint occaecat cupidatat
Line 13: Non proident sunt in culpa
Line 14: Qui officia deserunt mollit
Line 15: Anim id est laborum sed ut`)
  const [scrollbarUpdateKey, setScrollbarUpdateKey] = useState(0)
  
  // Force scrollbar update when content changes
  useEffect(() => {
    const timer = setTimeout(() => {
      setScrollbarUpdateKey(prev => prev + 1)
    }, 200) // Small delay to ensure content is rendered
    
    return () => { clearTimeout(timer) }
  }, []) // Only run once on mount
  
  // Validators
  const emailValidator: IInputValidator = (value: string) => {
    if (!value) {
      return { content: 'Email is required', type: MessageType.ERROR }
    }
    if (!value.includes('@')) {
      return { content: 'Invalid email format', type: MessageType.ERROR }
    }
    return null
  }

  const passwordValidator: IInputValidator = (value: string) => {
    if (value.length > 0 && value.length < 8) {
      return {
        content: 'Password should be at least 8 characters',
        type: MessageType.WARNING
      }
    }
    return null
  }

  const usernameValidator: IInputValidator = (value: string) => {
    if (value.length > 0) {
      return {
        content: 'Username will be used for login',
        type: MessageType.INFO
      }
    }
    return null
  }

  const handleThemeChange = (value: string): void => {
    void setTheme(value).catch((err: unknown) => {
      logger.error('Failed to change theme', { error: String(err) })
    })
  }

  const themeOptions = (themes as Theme[]).map(theme => ({
    value: theme.id,
    label: `${theme.name} (${theme.type})`
  }))

  // Tab content components
  const inputsContent = (
    <ScrollableElement
      key={`inputs-${scrollbarUpdateKey}`}
      options={{ vertical: 'auto', horizontal: 'hidden', useShadows: true }}
      style={{ height: '100%', width: '100%' }}
    >
      <div style={{ display: 'grid', gap: '20px', maxWidth: '600px', padding: '20px' }}>
      <h3 style={{ fontSize: '16px', marginBottom: '8px' }}>Basic Inputs</h3>
      
      <div>
        <label
          htmlFor="text-input"
          style={{
            display: 'block',
            marginBottom: '6px',
            fontSize: '13px'
          }}
        >
          Text Input
        </label>
        <div style={{ maxWidth: '400px' }}>
          <InputBox
          id="text-input"
            options={{
              placeholder: 'Enter text...',
              ariaLabel: 'Text input',
              tooltip: 'Basic text input'
            }}
          value={textInput}
            onChange={setTextInput}
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="number-input"
          style={{
            display: 'block',
            marginBottom: '6px',
            fontSize: '13px'
          }}
        >
          Number Input
        </label>
        <div style={{ maxWidth: '400px' }}>
          <InputBox
          id="number-input"
            options={{
              type: 'number',
              placeholder: 'Enter a number',
              ariaLabel: 'Number input',
              tooltip: 'Input for numeric values'
            }}
          value={numberInput}
            onChange={setNumberInput}
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="disabled-input"
          style={{
            display: 'block',
            marginBottom: '6px',
            fontSize: '13px',
            color: 'var(--vscode-descriptionForeground)'
          }}
        >
          Disabled Input
        </label>
        <div style={{ maxWidth: '400px' }}>
          <InputBox
          id="disabled-input"
            options={{
              placeholder: 'Cannot edit',
              ariaLabel: 'Disabled input'
            }}
          value="This input is disabled"
            disabled={true}
          />
        </div>
      </div>

      <h3 style={{ fontSize: '16px', marginTop: '20px', marginBottom: '8px' }}>
        Inputs with Validation
      </h3>

      <div>
        <label
          htmlFor="email-input"
          style={{
            display: 'block',
            marginBottom: '6px',
            fontSize: '13px'
          }}
        >
          Email Input (Error Validation)
        </label>
        <div style={{ maxWidth: '400px' }}>
          <InputBox
            id="email-input"
            options={{
              placeholder: 'email@example.com',
              ariaLabel: 'Email address',
              tooltip: 'Enter a valid email address',
              validationOptions: {
                validation: emailValidator
              }
            }}
            value={emailInput}
            onChange={setEmailInput}
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="password-input"
          style={{
            display: 'block',
            marginBottom: '6px',
            fontSize: '13px'
          }}
        >
          Password Input (Warning Validation)
        </label>
        <div style={{ maxWidth: '400px' }}>
          <InputBox
            id="password-input"
            options={{
              type: 'password',
              placeholder: 'Enter password',
              ariaLabel: 'Password',
              tooltip: 'Password should be at least 8 characters',
              validationOptions: {
                validation: passwordValidator
              }
            }}
            value={passwordInput}
            onChange={setPasswordInput}
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="username-input"
          style={{
            display: 'block',
            marginBottom: '6px',
            fontSize: '13px'
          }}
        >
          Username Input (Info Validation)
        </label>
        <div style={{ maxWidth: '400px' }}>
          <InputBox
            id="username-input"
            options={{
              placeholder: 'Username',
              ariaLabel: 'Username',
              tooltip: 'Enter your username',
              validationOptions: {
                validation: usernameValidator
              }
            }}
            value={usernameInput}
            onChange={setUsernameInput}
          />
        </div>
      </div>

      <h3 style={{ fontSize: '16px', marginTop: '20px', marginBottom: '8px' }}>
        TextArea (Flexible Height)
      </h3>
      
      <div>
        <label
          htmlFor="textarea-input"
          style={{
            display: 'block',
            marginBottom: '6px',
            fontSize: '13px'
          }}
        >
          Multi-line Text
        </label>
        <InputBox
          id="textarea-input"
          options={{
            flexibleHeight: true,
            placeholder: 'Enter multiple lines...',
            ariaLabel: 'Multi-line text area',
            tooltip: 'Flexible height textarea'
          }}
          value={textareaValue}
          onChange={setTextareaValue}
          style={{ minHeight: '120px' }}
      />
    </div>
      </div>
    </ScrollableElement>
  )

  const checkboxesContent = (
    <ScrollableElement
      key={`checkboxes-${scrollbarUpdateKey}`}
      options={{ vertical: 'auto', horizontal: 'hidden', useShadows: true }}
      style={{ height: '100%', width: '100%' }}
    >
      <div style={{ display: 'grid', gap: '30px', padding: '20px' }}>
      <div>
          <h3 style={{ fontSize: '16px', marginBottom: '12px' }}>VSCode Toggle Components</h3>
        <div style={{ display: 'grid', gap: '12px' }}>
            <Toggle
              opts={{
                title: 'Toggle (checked)',
                isChecked: toggleChecked,
                icon: 'check',
                inputActiveOptionBorder: 'var(--vscode-inputOption-activeBorder)',
                inputActiveOptionForeground: 'var(--vscode-inputOption-activeForeground)',
                inputActiveOptionBackground: 'var(--vscode-inputOption-activeBackground)'
              }}
              onChange={(checked: boolean) => { setToggleChecked(checked) }}
              label="Toggle (checked)"
            />

            <Toggle
              opts={{
                title: 'Toggle (unchecked)',
                isChecked: toggleUnchecked,
                icon: 'check',
                inputActiveOptionBorder: 'var(--vscode-inputOption-activeBorder)',
                inputActiveOptionForeground: 'var(--vscode-inputOption-activeForeground)',
                inputActiveOptionBackground: 'var(--vscode-inputOption-activeBackground)'
              }}
              onChange={(checked: boolean) => { setToggleUnchecked(checked) }}
              label="Toggle (unchecked)"
            />

            <Toggle
              opts={{
                title: 'Toggle (disabled)',
                isChecked: toggleDisabled,
                icon: 'check',
                inputActiveOptionBorder: 'var(--vscode-inputOption-activeBorder)',
                inputActiveOptionForeground: 'var(--vscode-inputOption-activeForeground)',
                inputActiveOptionBackground: 'var(--vscode-inputOption-activeBackground)'
              }}
              disabled={true}
              onChange={(checked: boolean) => { setToggleDisabled(checked) }}
              label="Toggle (disabled)"
            />
          </div>
        </div>
      </div>

      <div>
        <h3 style={{ fontSize: '16px', marginBottom: '12px' }}>VSCode Radio Components</h3>
        <div style={{ display: 'grid', gap: '20px' }}>
          <div>
            <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Basic Radio Group</h4>
            <RadioGroup
              options={{
                items: [
                  { text: 'Option 1', isActive: radioValue === 'option1' },
                  { text: 'Option 2', isActive: radioValue === 'option2' },
                  { text: 'Option 3', isActive: radioValue === 'option3' }
                ]
              }}
              onSelect={(index: number) => {
                setRadioValue(`option${index + 1}`)
              }}
            />
          </div>

          <div>
            <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Radio Group with Disabled Options</h4>
            <RadioGroup
              options={{
                items: [
                  { text: 'Enabled Option', isActive: true },
                  { text: 'Disabled Option', disabled: true },
                  { text: 'Another Option' }
                ]
              }}
              onSelect={(_index: number) => {
                // Handle selection for disabled options example
              }}
            />
          </div>

          <div>
            <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Radio Group with Tooltips</h4>
            <RadioGroup
              options={{
                items: [
                  { text: 'Option A', tooltip: 'This is option A' },
                  { text: 'Option B', tooltip: 'This is option B', isActive: true },
                  { text: 'Option C', tooltip: 'This is option C' }
                ]
              }}
              onSelect={(_index: number) => {
                // Handle selection for tooltips example
              }}
            />
          </div>
        </div>
      </div>
    </ScrollableElement>
  )

  // Button examples content
  const buttonsContent = (
    <ScrollableElement
      key={`buttons-${scrollbarUpdateKey}`}
      options={{ vertical: 'auto', horizontal: 'hidden', useShadows: true }}
      style={{ height: '100%', width: '100%' }}
    >
      <div style={{ display: 'grid', gap: '20px', maxWidth: '800px', padding: '20px' }}>
        <h3 style={{ fontSize: '16px', marginBottom: '8px' }}>VSCode Button Components</h3>
        
        <div>
          <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Basic Buttons</h4>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <Button
              options={{ disabled: false }}
              label="Primary Button"
              onClick={() => { logger.info('Primary button clicked') }}
            />
            <Button
              options={{ secondary: true }}
              label="Secondary Button"
              onClick={() => { logger.info('Secondary button clicked') }}
            />
            <Button
              options={{ disabled: true }}
              label="Disabled Button"
            />
          </div>
        </div>

        <div>
          <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Buttons with Icons</h4>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <Button
              options={{ disabled: false }}
              label="Save"
              icon="save"
              onClick={() => { logger.info('Save clicked') }}
            />
            <Button
              options={{ secondary: true }}
              label="Cancel"
              icon="close"
              onClick={() => { logger.info('Cancel clicked') }}
            />
            <Button
              options={{ disabled: false }}
              label="$(play) Start"
              onClick={() => { logger.info('Start clicked') }}
            />
          </div>
        </div>

        <div>
          <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Button with Description</h4>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <ButtonWithDescription
              options={{ disabled: false }}
              label="Deploy"
              description="Deploy to production environment"
              icon="rocket"
              onClick={() => { logger.info('Deploy clicked') }}
            />
            <ButtonWithDescription
              options={{ secondary: true }}
              label="Backup"
              description="Create system backup"
              icon="database"
              onClick={() => { logger.info('Backup clicked') }}
            />
          </div>
        </div>

        <div>
          <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Button with Dropdown</h4>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <ButtonWithDropdown
              options={{
                disabled: false,
                actions: [
                  { label: 'New File', onClick: () => { logger.info('New File') } },
                  { label: 'New Folder', onClick: () => { logger.info('New Folder') } },
                  { label: 'Import', onClick: () => { logger.info('Import') } }
                ]
              }}
              label="New"
              icon="add"
              onClick={() => { logger.info('New clicked') }}
            />
            <ButtonWithDropdown
              options={{
                secondary: false,
                actions: [
                  { label: 'Save', onClick: () => { logger.info('Save') } },
                  { label: 'Save As...', onClick: () => { logger.info('Save As') } },
                  { label: 'Export', onClick: () => { logger.info('Export') } }
                ]
              }}
              label="File"
              onClick={() => { logger.info('File clicked') }}
            />
          </div>
        </div>

        <div>
          <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Button with Icon Component</h4>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <ButtonWithIcon
              options={{ disabled: false }}
              icon="play"
              label="Start Process"
              onClick={() => { logger.info('Start Process clicked') }}
            />
            <ButtonWithIcon
              options={{ secondary: true }}
              icon="stop"
              label="Stop Process"
              onClick={() => { logger.info('Stop Process clicked') }}
            />
            <Button
              options={{ disabled: false }}
              label="$(play) Start with Inline Icon"
              onClick={() => { logger.info('Inline icon clicked') }}
            />
          </div>
        </div>

        <div>
          <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Short Label Support with Tooltip</h4>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <Button
              options={{ 
                disabled: false,
                supportShortLabel: true
              }}
              label="Very Long Button Label That Should Be Shortened"
              onClick={() => { logger.info('Short label clicked') }}
            />
            <Button
              options={{ 
                disabled: false,
                supportShortLabel: false
              }}
              label="Another Very Long Button Label That Will Show Tooltip When Truncated"
              onClick={() => { logger.info('Long label clicked') }}
            />
            <Button
              options={{ 
                disabled: false
              }}
              label="Short"
              onClick={() => { logger.info('Short button clicked') }}
            />
          </div>
        </div>
    </div>
    </ScrollableElement>
  )

  const dropdownsContent = (
    <ScrollableElement
      key={`dropdowns-${scrollbarUpdateKey}`}
      options={{ vertical: 'auto', horizontal: 'hidden', useShadows: true }}
      style={{ height: '100%', width: '100%' }}
    >
      <div style={{ display: 'grid', gap: '15px', padding: '20px' }}>
      <div>
        <h3 style={{ fontSize: '16px', marginBottom: '12px' }}>Custom Dropdown</h3>
        <CustomDropdown
          id="test-dropdown"
          value={selectValue}
          options={[
            { value: 'option1', label: 'Option 1' },
            { value: 'option2', label: 'Option 2' },
            { value: 'option3', label: 'Option 3' },
            { value: 'option4', label: 'Option 4' }
          ]}
          onChange={(value) => {
            setSelectValue(value)
          }}
          placeholder="Select an option"
        />
      </div>

      <div>
        <h3 style={{ fontSize: '16px', marginBottom: '12px' }}>Native Select</h3>
        <select
          value={selectValue}
          onChange={(e) => {
            setSelectValue(e.target.value)
          }}
          style={{
            width: '100%',
            maxWidth: '400px',
            padding: '6px 8px',
            backgroundColor: 'var(--vscode-dropdown-background)',
            color: 'var(--vscode-dropdown-foreground)',
            border: '1px solid var(--vscode-dropdown-border)',
            borderRadius: '2px',
            fontSize: '13px',
            fontFamily: 'inherit'
          }}
        >
          <option value="option1">Option 1</option>
          <option value="option2">Option 2</option>
          <option value="option3">Option 3</option>
          <option value="option4">Option 4</option>
        </select>
      </div>
    </div>
    </ScrollableElement>
  )

  const panelsContent = (
    <ScrollableElement
      key={`panels-${scrollbarUpdateKey}`}
      options={{ vertical: 'auto', horizontal: 'hidden', useShadows: true }}
      style={{ height: '100%', width: '100%' }}
    >
      <div style={{ display: 'grid', gap: '20px', padding: '20px' }}>
      <div
        style={{
          padding: '16px',
          backgroundColor: 'var(--vscode-sideBar-background)',
          border: '1px solid var(--vscode-panel-border)',
          borderRadius: '4px'
        }}
      >
        <h3 style={{ margin: '0 0 10px 0', fontSize: '14px' }}>Panel with Sidebar Background</h3>
        <p
          style={{
            margin: 0,
            fontSize: '13px',
            color: 'var(--vscode-descriptionForeground)'
          }}
        >
          This is a panel with sidebar background color and border.
        </p>
      </div>

      <div
        style={{
          border: '1px solid var(--vscode-panel-border)',
          borderRadius: '4px',
          overflow: 'hidden'
        }}
      >
        <h3 style={{ margin: '0', padding: '12px', fontSize: '14px', backgroundColor: 'var(--vscode-sideBar-background)', borderBottom: '1px solid var(--vscode-panel-border)' }}>List</h3>
        {['Item 1', 'Item 2 (hover me)', 'Item 3'].map((item, index) => (
          <div
            key={index}
            style={{
              padding: '10px 12px',
              fontSize: '13px',
              backgroundColor: index === 0 
                ? 'var(--vscode-list-activeSelectionBackground)' 
                : 'var(--vscode-sideBar-background)',
              color: index === 0
                ? 'var(--vscode-list-activeSelectionForeground)'
                : 'var(--vscode-foreground)',
              borderBottom: index < 2 ? '1px solid var(--vscode-panel-border)' : 'none',
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => {
              if (index !== 0) {
                e.currentTarget.style.backgroundColor = 'var(--vscode-list-hoverBackground)'
              }
            }}
            onMouseLeave={(e) => {
              if (index !== 0) {
                e.currentTarget.style.backgroundColor = 'var(--vscode-sideBar-background)'
              }
            }}
          >
            {item} {index === 0 ? '(selected)' : ''}
          </div>
        ))}
      </div>
    </div>
    </ScrollableElement>
  )

  const textContent = (
    <ScrollableElement
      key={`text-${scrollbarUpdateKey}`}
      options={{ vertical: 'auto', horizontal: 'hidden', useShadows: true }}
      style={{ height: '100%', width: '100%' }}
    >
      <div style={{ display: 'grid', gap: '10px', padding: '20px' }}>
      <div style={{ 
        padding: '12px', 
        backgroundColor: 'var(--vscode-sideBar-background)',
        border: '1px solid var(--vscode-panel-border)',
        borderRadius: '4px',
        marginBottom: '10px'
      }}>
        <p style={{ margin: '0 0 5px 0', fontSize: '12px', color: 'var(--vscode-descriptionForeground)' }}>
          Current font: <code style={{ fontSize: '11px' }}>{window.getComputedStyle(document.body).fontFamily}</code>
        </p>
        <p style={{ margin: 0, fontSize: '12px', color: 'var(--vscode-descriptionForeground)' }}>
          Expected: Inter (bundled with app)
        </p>
      </div>
      
      <p style={{ margin: 0, fontSize: '13px', color: 'var(--vscode-foreground)' }}>
        Normal text with foreground color
      </p>
      <p style={{ margin: 0, fontSize: '13px', color: 'var(--vscode-descriptionForeground)' }}>
        Description text with muted color
      </p>
      <p style={{ margin: 0, fontSize: '13px', color: 'var(--vscode-errorForeground)' }}>
        Error text (if available)
      </p>
      <p style={{ margin: 0, fontSize: '13px', fontWeight: 'bold' }}>
        Bold text (weight: 700)
      </p>
      <p style={{ margin: 0, fontSize: '13px', fontWeight: '500' }}>
        Medium text (weight: 500)
      </p>
      <p style={{ margin: 0, fontSize: '13px', fontStyle: 'italic' }}>
        Italic text
      </p>
      <code
        style={{
          display: 'inline-block',
          padding: '2px 6px',
          fontSize: '12px',
          backgroundColor: 'var(--vscode-textCodeBlock-background)',
          border: '1px solid var(--vscode-panel-border)',
          borderRadius: '3px',
          fontFamily: 'inherit'
        }}
      >
        inline code
      </code>
      
      <div style={{ marginTop: '20px' }}>
        <h3 style={{ fontSize: '16px', marginBottom: '8px' }}>Font Samples</h3>
        <p style={{ margin: '5px 0', fontSize: '20px' }}>The quick brown fox jumps</p>
        <p style={{ margin: '5px 0', fontSize: '16px' }}>The quick brown fox jumps over the lazy dog</p>
        <p style={{ margin: '5px 0', fontSize: '13px' }}>The quick brown fox jumps over the lazy dog 0123456789</p>
        <p style={{ margin: '5px 0', fontSize: '11px' }}>The quick brown fox jumps over the lazy dog</p>
      </div>
    </div>
    </ScrollableElement>
  )

  // ScrollableElement examples content
  const scrollbarsContent = (
    <ScrollableElement
      key={`scrollbars-${scrollbarUpdateKey}`}
      options={{ vertical: 'auto', horizontal: 'hidden', useShadows: true }}
      style={{ height: '100%', width: '100%' }}
    >
      <div style={{ display: 'grid', gap: '20px', maxWidth: '800px', padding: '20px' }}>
      <h3 style={{ fontSize: '16px', marginBottom: '8px' }}>VSCode ScrollableElement Components</h3>
      
      <div>
        <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Scrollable Content (Vertical)</h4>
        <ScrollableElement
          options={{ vertical: 'auto', horizontal: 'hidden', useShadows: true }}
          style={{ height: '200px', width: '400px', border: '1px solid var(--vscode-panel-border)' }}
        >
          <div style={{ height: '600px', padding: '20px', backgroundColor: 'var(--vscode-editor-background)' }}>
            <h5 style={{ margin: '0 0 10px 0' }}>Long Content</h5>
            <p>This is a long content area that demonstrates vertical scrolling.</p>
            <p>You can scroll up and down to see more content.</p>
            <p>The scrollbar will appear automatically when needed.</p>
            <p>It will hide after a few seconds of inactivity.</p>
            <p>Hover over the content to show the scrollbar again.</p>
            <p>This content is much taller than the container.</p>
            <p>Scroll to see all the content below.</p>
            <p>More content here...</p>
            <p>Even more content...</p>
            <p>Keep scrolling...</p>
            <p>Almost at the end...</p>
            <p>Final content at the bottom!</p>
          </div>
        </ScrollableElement>
        <p style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', marginTop: '8px' }}>
          Vertical scrolling with auto-hide scrollbar and shadows
        </p>
      </div>

      <div>
        <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Scrollable Content (Both Axes)</h4>
        <ScrollableElement
          options={{
            vertical: 'auto',
            horizontal: 'auto',
            verticalHasArrows: true,
            horizontalHasArrows: true,
            useShadows: true
          }}
          style={{ height: '200px', width: '400px', border: '1px solid var(--vscode-panel-border)' }}
        >
          <div style={{ width: '800px', height: '600px', padding: '20px', backgroundColor: 'var(--vscode-editor-background)' }}>
            <h5 style={{ margin: '0 0 10px 0' }}>Wide and Tall Content</h5>
            <p>This content is both wider and taller than the container.</p>
            <p>You can scroll both horizontally and vertically.</p>
            <p>The scrollbars have arrow buttons for precise navigation.</p>
            <p>Hover to see the scrollbars appear.</p>
            <p>This demonstrates both horizontal and vertical scrolling.</p>
            <p>Content continues to the right...</p>
            <p>And also continues downward...</p>
            <p>You can scroll in all directions.</p>
            <p>More content in all directions...</p>
            <p>Keep scrolling to explore...</p>
            <p>This is a comprehensive scrolling example.</p>
          </div>
        </ScrollableElement>
        <p style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', marginTop: '8px' }}>
          Both horizontal and vertical scrolling with arrows
        </p>
      </div>

      <div>
        <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Always Visible Scrollbars</h4>
        <ScrollableElement
          options={{ vertical: 'visible', horizontal: 'visible' }}
          style={{ height: '200px', width: '400px', border: '1px solid var(--vscode-panel-border)' }}
        >
          <div style={{ height: '400px', padding: '20px', backgroundColor: 'var(--vscode-editor-background)' }}>
            <h5 style={{ margin: '0 0 10px 0' }}>Always Visible</h5>
            <p>These scrollbars are always visible.</p>
            <p>They don&apos;t hide automatically.</p>
            <p>Perfect for cases where you want constant visibility.</p>
            <p>No need to hover to see the scrollbars.</p>
            <p>They remain visible at all times.</p>
            <p>This is useful for accessibility.</p>
            <p>Or when you want to show scroll state.</p>
            <p>Content continues below...</p>
            <p>More content to scroll through...</p>
            <p>Scrollbars stay visible!</p>
          </div>
        </ScrollableElement>
        <p style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', marginTop: '8px' }}>
          Scrollbars are always visible regardless of mouse interaction
        </p>
      </div>

      <div>
        <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Hidden Scrollbars</h4>
        <ScrollableElement
          options={{ vertical: 'hidden', horizontal: 'hidden' }}
          style={{ height: '200px', width: '400px', border: '1px solid var(--vscode-panel-border)' }}
        >
          <div style={{ height: '400px', padding: '20px', backgroundColor: 'var(--vscode-editor-background)' }}>
            <h5 style={{ margin: '0 0 10px 0' }}>No Scrollbars</h5>
            <p>This content has scrollbars completely hidden.</p>
            <p>You can still scroll with mouse wheel or touch.</p>
            <p>But no visual scrollbar indicators.</p>
            <p>Useful for clean interfaces.</p>
            <p>Or when you want minimal visual clutter.</p>
            <p>Content continues below...</p>
            <p>More content to scroll through...</p>
            <p>No scrollbars visible!</p>
          </div>
        </ScrollableElement>
        <p style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', marginTop: '8px' }}>
          Scrollbars are completely hidden but scrolling still works
        </p>
      </div>
      </div>
    </ScrollableElement>
  )

  // ProgressBar examples content
  const progressBarContent = (
    <ScrollableElement
      key={`progress-${scrollbarUpdateKey}`}
      options={{ vertical: 'auto', horizontal: 'hidden', useShadows: true }}
      style={{ height: '100%', width: '100%' }}
    >
      <div style={{ display: 'grid', gap: '20px', maxWidth: '600px', padding: '20px' }}>
        <h3 style={{ fontSize: '16px', marginBottom: '8px' }}>VSCode ProgressBar Components</h3>
        
        <div>
          <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Infinite Progress Bar</h4>
          <ProgressBar mode="infinite" />
          <p style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', marginTop: '8px' }}>
            Continuous progress indicator with animation
          </p>
        </div>

        <div>
          <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Discrete Progress Bar (50%)</h4>
          <ProgressBar mode="discrete" value={50} total={100} />
          <p style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', marginTop: '8px' }}>
            Progress bar showing 50% completion
          </p>
        </div>

        <div>
          <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Discrete Progress Bar (75%)</h4>
          <ProgressBar mode="discrete" value={75} total={100} />
          <p style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', marginTop: '8px' }}>
            Progress bar showing 75% completion
          </p>
        </div>

        <div>
          <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Custom Color Progress Bar</h4>
          <ProgressBar 
            mode="discrete" 
            value={30} 
            total={100}
            options={{ progressBarBackground: '#ff6b6b' }}
          />
          <p style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', marginTop: '8px' }}>
            Progress bar with custom red color
          </p>
        </div>

        <div>
          <h4 style={{ fontSize: '14px', marginBottom: '8px' }}>Completed Progress Bar</h4>
          <ProgressBar mode="done" />
          <p style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', marginTop: '8px' }}>
            Progress bar in completed state
          </p>
        </div>
      </div>
    </ScrollableElement>
  )

  const tabs: Tab[] = [
    { id: 'buttons', label: 'Buttons', content: buttonsContent },
    { id: 'scrollbars', label: 'Scrollbars', content: scrollbarsContent },
    { id: 'divers', label: 'Divers', content: progressBarContent },
    { id: 'checkboxes', label: 'Checkboxes & Radio', content: checkboxesContent },
    { id: 'inputs', label: 'Text Inputs', content: inputsContent },
    { id: 'dropdowns', label: 'Dropdowns', content: dropdownsContent },
    { id: 'panels', label: 'Panels & Lists', content: panelsContent },
    { id: 'text', label: 'Text Styles', content: textContent }
  ]

  return (
    <ScrollableElement
      key={`main-${scrollbarUpdateKey}`}
      options={{ vertical: 'auto', horizontal: 'hidden', useShadows: true }}
      style={{ height: '100vh', width: '100vw' }}
    >
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
            <CustomDropdown
              id="theme-selector"
              value={currentThemeId ?? ''}
              options={themeOptions}
              onChange={handleThemeChange}
              disabled={isLoading}
              placeholder={t('themeTest.selectTheme')}
            />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <CustomTabs tabs={tabs} />
      </div>
    </div>
    </ScrollableElement>
  )
}

export default ThemeTestPage
