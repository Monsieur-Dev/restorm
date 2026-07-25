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
  const [starChecked, setStarChecked] = useState(false)

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
          checked={checkedA}
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
          checked={checkedB}
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
          checked={disabledChecked}
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
          checked={noFocusChecked}
          notFocusable={true}
          onChange={(checked, viaKeyboard) => {
            setNoFocusChecked(checked)
            setLastChange({ id: 'toggle-no-focus', checked, viaKeyboard })
            setChangeCount((c) => c + 1)
          }}
        >
          {t('toggle.harness.noFocusLabel')}
        </Toggle>

        {/* The `star` appearance deliberately draws NO focus ring. It is here so
            the shared negative BDD step can assert that opt-out actually holds
            under keyboard focus. The assertion is only meaningful because this
            harness renders inside the provider's `.workbench`, which is where
            the host's global focus rule competes for the same element — outside
            one, "no ring" would be true no matter what the opt-out did.
            Deliberately unlabelled: the accessible name falls back to the
            component default, which keeps a test-only control out of every
            locale file. */}
        <Toggle
          appearance="star"
          data-testid="toggle-star"
          checked={starChecked}
          onChange={(checked, viaKeyboard) => {
            setStarChecked(checked)
            setLastChange({ id: 'toggle-star', checked, viaKeyboard })
            setChangeCount((c) => c + 1)
          }}
        />
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        <div data-testid="toggle-change-count">{String(changeCount)}</div>
        <div data-testid="toggle-last-change">{lastChangeText}</div>
      </div>
    </div>
  )
}

export default ToggleTab
