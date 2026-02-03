import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SelectBox } from 'electron-core-ui/renderer'
import type { ISelectData, ISelectOptionItem } from 'electron-core-ui/renderer'

interface LastSelectEvent {
  selectId: string
  index: number
  selected: string
}

function makeOptions(count: number): ISelectOptionItem[] {
  const options: ISelectOptionItem[] = []
  for (let i = 0; i < count; i += 1) {
    options.push({ text: `Option ${i}` })
  }
  return options
}

const SelectBoxTab: React.FC = () => {
  const { t } = useTranslation()

  const basicOptions = useMemo<ISelectOptionItem[]>(() => [
    { text: 'Alpha' },
    { text: 'Beta', detail: 'B', decoratorRight: 'Default' },
    { text: 'Gamma' }
  ], [])

  const disabledOptions = useMemo<ISelectOptionItem[]>(() => [
    { text: 'Enabled 0' },
    { text: 'Disabled 1', isDisabled: true },
    { text: 'Enabled 2' }
  ], [])

  const detailsOptions = useMemo<ISelectOptionItem[]>(() => [
    { text: 'Theme A', description: 'Description for Theme A' },
    { text: 'Theme B', description: 'Description for Theme B' },
    { text: 'Theme C', description: 'Description for Theme C' }
  ], [])

  const longOptions = useMemo<ISelectOptionItem[]>(() => makeOptions(80), [])

  const [changeCount, setChangeCount] = useState(0)
  const [last, setLast] = useState<LastSelectEvent | null>(null)

  const onDidSelect = useCallback((selectId: string) => (data: ISelectData) => {
    setChangeCount((c) => c + 1)
    setLast({ selectId, index: data.index, selected: data.selected })
  }, [])

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 900, padding: 20 }}>
      <div data-testid="selectbox-ready">true</div>

      <h3 style={{ fontSize: 16, marginBottom: 0 }}>{t('selectBox.harness.title')}</h3>

      <div style={{ display: 'grid', gap: 14 }}>
        <div>
          <div style={{ marginBottom: 6, opacity: 0.7 }}>{t('selectBox.harness.basic')}</div>
          <SelectBox
            id="selectbox-basic"
            data-testid="selectbox-basic"
            className=""
            options={basicOptions}
            selected={0}
            onDidSelect={onDidSelect('selectbox-basic')}
            selectBoxOptions={{ useCustomDrawn: true, ariaLabel: 'Basic select box' }}
          />
        </div>

        <div>
          <div style={{ marginBottom: 6, opacity: 0.7 }}>{t('selectBox.harness.withDisabled')}</div>
          <SelectBox
            id="selectbox-with-disabled"
            data-testid="selectbox-with-disabled"
            className=""
            options={disabledOptions}
            selected={0}
            onDidSelect={onDidSelect('selectbox-with-disabled')}
            selectBoxOptions={{ useCustomDrawn: true, ariaLabel: 'Select box with disabled options' }}
          />
        </div>

        <div>
          <div style={{ marginBottom: 6, opacity: 0.7 }}>{t('selectBox.harness.withDetails')}</div>
          <SelectBox
            id="selectbox-with-details"
            data-testid="selectbox-with-details"
            className=""
            options={detailsOptions}
            selected={0}
            onDidSelect={onDidSelect('selectbox-with-details')}
            selectBoxOptions={{ useCustomDrawn: true, ariaLabel: 'Select box with details' }}
          />
        </div>

        <div>
          <div style={{ marginBottom: 6, opacity: 0.7 }}>{t('selectBox.harness.longList')}</div>
          <SelectBox
            id="selectbox-long"
            data-testid="selectbox-long"
            className=""
            options={longOptions}
            selected={0}
            onDidSelect={onDidSelect('selectbox-long')}
            selectBoxOptions={{ useCustomDrawn: true, ariaLabel: 'Select box long list' }}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        <div data-testid="selectbox-change-count">{String(changeCount)}</div>
        <div data-testid="selectbox-last-selected-id">{last?.selectId ?? ''}</div>
        <div data-testid="selectbox-last-selected-index">{last ? String(last.index) : ''}</div>
        <div data-testid="selectbox-last-selected-text">{last?.selected ?? ''}</div>
      </div>
    </div>
  )
}

export default SelectBoxTab
