import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ColorPicker } from 'electron-core-ui/renderer'

interface ColorPickerHarnessState {
  value: string
  lastChange: string | null
}

function useColorPickerHarness(initial: string): [ColorPickerHarnessState, (next: string) => void] {
  const [state, setState] = useState<ColorPickerHarnessState>({ value: initial, lastChange: null })
  const onChange = useCallback((next: string): void => {
    setState({ value: next, lastChange: next })
  }, [])
  return [state, onChange]
}

const ColorPickerTab: React.FC = () => {
  const { t } = useTranslation()

  const [basic, onBasicChange] = useColorPickerHarness('#ff00aa')
  const [alpha, onAlphaChange] = useColorPickerHarness('#00aaff')

  const sectionStyle = useMemo<React.CSSProperties>(() => ({
    padding: 20,
    maxWidth: 1000,
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
    gridTemplateColumns: '240px 1fr',
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
        <h3 style={{ margin: 0 }}>{t('colorPicker.harness.basicTitle')}</h3>

        <ColorPicker
          data-testid="colorpicker-basic"
          value={basic.value}
          onChange={onBasicChange}
        />

        <div style={metaGridStyle}>
          <div style={metaKeyStyle}>value</div>
          <div data-testid="colorpicker-basic-value">{basic.value}</div>

          <div style={metaKeyStyle}>last change</div>
          <div data-testid="colorpicker-basic-last-change">{basic.lastChange ?? ''}</div>
        </div>
      </div>

      <div style={cardStyle}>
        <h3 style={{ margin: 0 }}>{t('colorPicker.harness.alphaTitle')}</h3>

        <ColorPicker
          data-testid="colorpicker-alpha"
          value={alpha.value}
          onChange={onAlphaChange}
          disableAlpha={false}
        />

        <div style={metaGridStyle}>
          <div style={metaKeyStyle}>value</div>
          <div data-testid="colorpicker-alpha-value">{alpha.value}</div>

          <div style={metaKeyStyle}>last change</div>
          <div data-testid="colorpicker-alpha-last-change">{alpha.lastChange ?? ''}</div>
        </div>
      </div>
    </div>
  )
}

export default ColorPickerTab
