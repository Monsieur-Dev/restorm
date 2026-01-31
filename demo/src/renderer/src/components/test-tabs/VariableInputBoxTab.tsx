import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { VariableInputBox } from 'electron-core-ui/renderer'
import type { VariableDefinition } from 'electron-core-ui/renderer'

const DEFAULT_VALUE = 'Hello {{foo}}'

const variables: VariableDefinition[] = [
  { name: 'foo', value: 'fooValue', description: 'A demo variable' },
  { name: 'bar', value: 'barValue' }
]

const VariableInputBoxTab: React.FC = () => {
  const { t } = useTranslation()

  const [valueInput, setValueInput] = useState(DEFAULT_VALUE)
  const [basicValue, setBasicValue] = useState('')
  const [noProvidersValue, setNoProvidersValue] = useState('')
  const [customMenuValue, setCustomMenuValue] = useState('')
  const [lastChange, setLastChange] = useState('')
  const [lastContextAction, setLastContextAction] = useState('')

  const applyValueTo = useCallback((target: 'basic' | 'no-providers' | 'custom-menu'): void => {
    if (target === 'basic') {
      setBasicValue(valueInput)
      setLastChange(valueInput)
      return
    }
    if (target === 'no-providers') {
      setNoProvidersValue(valueInput)
      setLastChange(valueInput)
      return
    }
    setCustomMenuValue(valueInput)
    setLastChange(valueInput)
  }, [valueInput])

  const sectionStyle = useMemo<React.CSSProperties>(() => ({
    padding: 20,
    maxWidth: 900,
    display: 'grid',
    gap: 18
  }), [])

  const cardStyle = useMemo<React.CSSProperties>(() => ({
    border: '1px solid var(--panel-border)',
    backgroundColor: 'var(--sideBar-background)',
    padding: 16,
    borderRadius: 4,
    display: 'grid',
    gap: 10
  }), [])

  const metaGridStyle = useMemo<React.CSSProperties>(() => ({
    display: 'grid',
    gridTemplateColumns: '220px 1fr',
    gap: 8,
    alignItems: 'center',
    fontSize: 13
  }), [])

  const metaKeyStyle = useMemo<React.CSSProperties>(() => ({
    color: 'var(--descriptionForeground)'
  }), [])

  return (
    <div style={sectionStyle}>
      <div style={cardStyle}>
        <h3 style={{ margin: 0 }}>{t('variableInputBox.harness.title')}</h3>

        {/* Shared value input (reused by CodeEditor/InputBox wrapper steps) */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            data-testid="codeeditor-value-input"
            value={valueInput}
            onChange={(e) => { setValueInput(e.target.value) }}
            style={{ minWidth: 320 }}
          />
          <button data-testid="variableinputbox-apply-value-basic" onClick={() => { applyValueTo('basic') }}>
            {t('variableInputBox.harness.applyValueBasic')}
          </button>
          <button data-testid="variableinputbox-apply-value-no-providers" onClick={() => { applyValueTo('no-providers') }}>
            {t('variableInputBox.harness.applyValueNoProviders')}
          </button>
          <button data-testid="variableinputbox-apply-value-custom-menu" onClick={() => { applyValueTo('custom-menu') }}>
            {t('variableInputBox.harness.applyValueCustomMenu')}
          </button>
        </div>

        <div style={metaGridStyle}>
          <div style={metaKeyStyle}>{t('variableInputBox.harness.ready')}</div>
          <div data-testid="variableinputbox-ready">true</div>

          <div style={metaKeyStyle}>{t('variableInputBox.harness.lastChange')}</div>
          <div data-testid="variableinputbox-last-change">{lastChange}</div>

          <div style={metaKeyStyle}>{t('variableInputBox.harness.lastContextAction')}</div>
          <div data-testid="variableinputbox-last-context-action">{lastContextAction}</div>
        </div>
      </div>

      <div style={cardStyle}>
        <h3 style={{ margin: 0 }}>{t('variableInputBox.harness.instances')}</h3>

        <div style={{ display: 'grid', gap: 14 }}>
          <div>
            <div style={metaKeyStyle}>{t('variableInputBox.harness.basic')}</div>
            <VariableInputBox
              data-testid="variableinputbox-basic"
              value={basicValue}
              onChange={(v) => {
                setBasicValue(v)
                setLastChange(v)
              }}
              variables={variables}
              placeholder={t('variableInputBox.harness.basicPlaceholder')}
              ariaLabel={t('variableInputBox.harness.basicAriaLabel')}
            />
          </div>

          <div>
            <div style={metaKeyStyle}>{t('variableInputBox.harness.noProviders')}</div>
            <VariableInputBox
              data-testid="variableinputbox-no-providers"
              value={noProvidersValue}
              onChange={(v) => {
                setNoProvidersValue(v)
                setLastChange(v)
              }}
              variables={variables}
              placeholder={t('variableInputBox.harness.noProvidersPlaceholder')}
              disableDefaultProviders={true}
              ariaLabel={t('variableInputBox.harness.noProvidersAriaLabel')}
            />
          </div>

          <div>
            <div style={metaKeyStyle}>{t('variableInputBox.harness.customMenu')}</div>
            <VariableInputBox
              data-testid="variableinputbox-custom-menu"
              value={customMenuValue}
              onChange={(v) => {
                setCustomMenuValue(v)
                setLastChange(v)
              }}
              variables={variables}
              placeholder={t('variableInputBox.harness.customMenuPlaceholder')}
              contextMenuItems={[
                {
                  id: 'custom-action',
                  label: t('variableInputBox.harness.customActionLabel'),
                  onClick: () => { setLastContextAction('custom-action') }
                }
              ]}
              ariaLabel={t('variableInputBox.harness.customMenuAriaLabel')}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default VariableInputBoxTab
