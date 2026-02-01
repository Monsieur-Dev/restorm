import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Toggle } from 'electron-core-ui/renderer'

interface LastChange {
  id: string
  checked: boolean
  viaKeyboard: boolean
}

const ToggleTab: React.FC = () => {
  const { t } = useTranslation()

  const [changeCount, setChangeCount] = useState(0)
  const [lastChange, setLastChange] = useState<LastChange | null>(null)

  const [checkedA, setCheckedA] = useState(true)
  const [checkedB, setCheckedB] = useState(false)
  const [disabledChecked, setDisabledChecked] = useState(false)
  const [noFocusChecked, setNoFocusChecked] = useState(false)

  const lastChangeText = useMemo(() => {
    if (!lastChange) return ''
    return JSON.stringify(lastChange)
  }, [lastChange])

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 900, padding: 20 }}>
      <div data-testid="toggle-ready">true</div>

      <h3 style={{ fontSize: 16, marginBottom: 0 }}>{t('toggle.harness.title')}</h3>

      <div style={{ display: 'grid', gap: 10 }}>
        <Toggle
          data-testid="toggle-basic-checked"
          isChecked={checkedA}
          onChange={(checked, viaKeyboard) => {
            setCheckedA(checked)
            setLastChange({ id: 'toggle-basic-checked', checked, viaKeyboard })
            setChangeCount((c) => c + 1)
          }}
        >
          {t('toggle.harness.checkedLabel')}
        </Toggle>

        <Toggle
          data-testid="toggle-basic-unchecked"
          isChecked={checkedB}
          onChange={(checked, viaKeyboard) => {
            setCheckedB(checked)
            setLastChange({ id: 'toggle-basic-unchecked', checked, viaKeyboard })
            setChangeCount((c) => c + 1)
          }}
        >
          {t('toggle.harness.uncheckedLabel')}
        </Toggle>

        <Toggle
          data-testid="toggle-disabled"
          isChecked={disabledChecked}
          disabled={true}
          onChange={(checked, viaKeyboard) => {
            setDisabledChecked(checked)
            setLastChange({ id: 'toggle-disabled', checked, viaKeyboard })
            setChangeCount((c) => c + 1)
          }}
        >
          {t('toggle.harness.disabledLabel')}
        </Toggle>

        <Toggle
          data-testid="toggle-no-focus"
          isChecked={noFocusChecked}
          notFocusable={true}
          onChange={(checked, viaKeyboard) => {
            setNoFocusChecked(checked)
            setLastChange({ id: 'toggle-no-focus', checked, viaKeyboard })
            setChangeCount((c) => c + 1)
          }}
        >
          {t('toggle.harness.noFocusLabel')}
        </Toggle>
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        <div data-testid="toggle-change-count">{String(changeCount)}</div>
        <div data-testid="toggle-last-change">{lastChangeText}</div>
      </div>
    </div>
  )
}

export default ToggleTab
