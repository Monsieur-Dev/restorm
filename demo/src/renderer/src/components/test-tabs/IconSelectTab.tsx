import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IconSelect } from 'electron-core-ui/renderer'
import type { Icon } from 'electron-core-ui/types'

const IconSelectTab: React.FC = () => {
  const { t } = useTranslation()

  const [selected, setSelected] = useState<Icon | null>(null)
  const [changeCount, setChangeCount] = useState(0)

  const onChange = useCallback((next: Icon | null) => {
    setSelected(next)
    setChangeCount((c) => c + 1)
  }, [])

  const selectedType = useMemo(() => selected?.type ?? '', [selected])
  const selectedValue = useMemo(() => selected?.value ?? '', [selected])

  const readonlyValue = useMemo<Icon>(() => ({ type: 'codicon', value: 'folder' }), [])

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 900, padding: 20 }}>
      <div data-testid="iconselect-ready">true</div>

      <h3 style={{ fontSize: 16, marginBottom: 0 }}>{t('iconSelect.harness.title')}</h3>

      <div style={{ display: 'grid', gap: 12 }}>
        <div>
          <div style={{ marginBottom: 6 }}>{t('iconSelect.harness.basic')}</div>
          <IconSelect data-testid="iconselect-basic" value={selected} onChange={onChange} />
        </div>

        <div>
          <div style={{ marginBottom: 6 }}>{t('iconSelect.harness.disabled')}</div>
          <IconSelect data-testid="iconselect-disabled" value={null} onChange={onChange} disabled />
        </div>

        <div>
          <div style={{ marginBottom: 6 }}>{t('iconSelect.harness.readonly')}</div>
          <IconSelect data-testid="iconselect-readonly" value={readonlyValue} readonly />
        </div>
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        <div data-testid="iconselect-change-count">{String(changeCount)}</div>
        <div data-testid="iconselect-selected-type">{selectedType}</div>
        <div data-testid="iconselect-selected-value">{selectedValue}</div>
      </div>
    </div>
  )
}

export default IconSelectTab
