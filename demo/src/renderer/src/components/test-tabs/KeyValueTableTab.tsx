import React, { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyValueTable } from 'electron-core-ui/renderer'
import type { KeyValueTableHandle, KeyValueTableRow } from 'electron-core-ui/renderer'

const KeyValueTableTab: React.FC = () => {
  const { t } = useTranslation()

  const basicRef = useRef<KeyValueTableHandle | null>(null)

  const initialRows: KeyValueTableRow[] = useMemo(() => ([
    { id: 'row-1', enabled: true, key: 'foo', value: 'bar', description: 'first row' },
    { id: 'row-2', enabled: true, key: 'hello', value: 'world', description: 'second row' }
  ]), [])

  const [basicRows, setBasicRows] = useState<KeyValueTableRow[]>(initialRows)
  const [emptyRows, setEmptyRows] = useState<KeyValueTableRow[]>([])

  const rowOrder = useMemo(() => basicRows.map((r) => r.id ?? '').filter(Boolean).join(','), [basicRows])

  return (
    <div style={{ padding: 20, maxWidth: 1100, display: 'grid', gap: 18 }}>
      <div style={{ display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0 }}>{t('keyValueTable.harness.title')}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 8, fontSize: 13 }}>
          <div>{t('keyValueTable.harness.ready')}</div>
          <div data-testid="keyvaluetable-ready">true</div>

          <div>{t('keyValueTable.harness.rowOrder')}</div>
          <div data-testid="keyvaluetable-row-order">{rowOrder}</div>

          <div>{t('keyValueTable.harness.lastRows')}</div>
          <pre data-testid="keyvaluetable-last-rows" style={{ margin: 0, fontSize: 11 }}>
            {JSON.stringify(basicRows, null, 2)}
          </pre>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            data-testid="keyvaluetable-add-row"
            onClick={() => { basicRef.current?.addRow() }}
          >
            {t('keyValueTable.harness.addRow')}
          </button>
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ fontSize: 13, color: 'var(--descriptionForeground)' }}>{t('keyValueTable.harness.basic')}</div>
          <KeyValueTable
            ref={basicRef}
            data-testid="keyvaluetable-basic"
            initialRows={initialRows}
            onRowsChange={(rows) => { setBasicRows(rows) }}
          />
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ fontSize: 13, color: 'var(--descriptionForeground)' }}>{t('keyValueTable.harness.empty')}</div>
          <KeyValueTable
            data-testid="keyvaluetable-empty"
            initialRows={emptyRows}
            onRowsChange={(rows) => { setEmptyRows(rows) }}
          />
        </div>
      </div>
    </div>
  )
}

export default KeyValueTableTab
