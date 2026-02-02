import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RadioGroup } from 'electron-core-ui/renderer'

interface LastSelect {
  testId: string
  index: number
}

const RadioTab: React.FC = () => {
  const { t } = useTranslation()

  const [selectCount, setSelectCount] = useState(0)
  const [lastSelect, setLastSelect] = useState<LastSelect | null>(null)

  const [basicIndex, setBasicIndex] = useState(0)
  const [withDisabledIndex, setWithDisabledIndex] = useState(0)
  const [withTooltipsIndex, setWithTooltipsIndex] = useState(1)

  const lastSelectText = useMemo(() => {
    if (!lastSelect) return ''
    return JSON.stringify(lastSelect)
  }, [lastSelect])

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 900, padding: 20 }}>
      <div data-testid="radio-ready">true</div>

      <h3 style={{ fontSize: 16, marginBottom: 0 }}>{t('radio.harness.title')}</h3>

      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ display: 'grid', gap: 8 }}>
          <h4 style={{ fontSize: 14, marginBottom: 0 }}>{t('radio.harness.basicTitle')}</h4>
          <RadioGroup
            data-testid="radio-basic"
            options={{
              items: [
                { text: t('radio.harness.option1'), isActive: basicIndex === 0 },
                { text: t('radio.harness.option2'), isActive: basicIndex === 1 },
                { text: t('radio.harness.option3'), isActive: basicIndex === 2 }
              ]
            }}
            onSelect={(index) => {
              setBasicIndex(index)
              setLastSelect({ testId: 'radio-basic', index })
              setSelectCount((c) => c + 1)
            }}
          />
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          <h4 style={{ fontSize: 14, marginBottom: 0 }}>{t('radio.harness.disabledTitle')}</h4>
          <RadioGroup
            data-testid="radio-with-disabled"
            options={{
              items: [
                { text: t('radio.harness.enabledOption'), isActive: withDisabledIndex === 0 },
                { text: t('radio.harness.disabledOption'), disabled: true, isActive: withDisabledIndex === 1 },
                { text: t('radio.harness.anotherOption'), isActive: withDisabledIndex === 2 }
              ]
            }}
            onSelect={(index) => {
              setWithDisabledIndex(index)
              setLastSelect({ testId: 'radio-with-disabled', index })
              setSelectCount((c) => c + 1)
            }}
          />
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          <h4 style={{ fontSize: 14, marginBottom: 0 }}>{t('radio.harness.tooltipsTitle')}</h4>
          <RadioGroup
            data-testid="radio-with-tooltips"
            options={{
              items: [
                { text: t('radio.harness.optionA'), tooltip: t('radio.harness.tooltipA'), isActive: withTooltipsIndex === 0 },
                { text: t('radio.harness.optionB'), tooltip: t('radio.harness.tooltipB'), isActive: withTooltipsIndex === 1 },
                { text: t('radio.harness.optionC'), tooltip: t('radio.harness.tooltipC'), isActive: withTooltipsIndex === 2 }
              ]
            }}
            onSelect={(index) => {
              setWithTooltipsIndex(index)
              setLastSelect({ testId: 'radio-with-tooltips', index })
              setSelectCount((c) => c + 1)
            }}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        <div data-testid="radio-select-count">{String(selectCount)}</div>
        <div data-testid="radio-last-select">{lastSelectText}</div>
      </div>
    </div>
  )
}

export default RadioTab
