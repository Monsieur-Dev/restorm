import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ListViewItemData, ListViewItemEventPayload } from 'electron-core-ui/renderer'
import { ListViewDropdown } from 'electron-core-ui/renderer'

const ListViewDropdownE2ETab: React.FC = () => {
  const { t } = useTranslation()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [lastClicked, setLastClicked] = useState<string>('')

  const items = useMemo((): ListViewItemData[] => ([
    { id: 'alpha', title: t('listViewDropdown.harness.items.alpha') },
    { id: 'beta', title: t('listViewDropdown.harness.items.beta') },
    { id: 'gamma', title: t('listViewDropdown.harness.items.gamma') }
  ]), [t])

  const selectedIds = useMemo((): string[] => (selectedId ? [selectedId] : []), [selectedId])

  const selectedLabel = useMemo((): string => {
    if (!selectedId) return t('listViewDropdown.harness.button.default')
    const item = items.find((it) => it.id === selectedId)
    const title = item?.title
    return typeof title === 'string' ? title : selectedId
  }, [items, selectedId, t])

  const handleItemClick = useCallback((payload: ListViewItemEventPayload): void => {
    setSelectedId(payload.item.id)
    setLastClicked(payload.item.id)
  }, [])

  return (
    <div style={{ padding: 16 }}>
      <div style={{ marginBottom: 8 }}>
        {t('listViewDropdown.harness.instructions')}
      </div>

      <ListViewDropdown
        data-testid="listviewdropdown-e2e"
        items={items}
        menuAriaLabel={t('listViewDropdown.harness.menuAriaLabel')}
        selectedIds={selectedIds}
        buttonContent={selectedLabel}
        onItemClick={handleItemClick}
      />

      <div data-testid="listviewdropdown-ready">true</div>
      <div data-testid="listviewdropdown-last-clicked">{lastClicked}</div>
    </div>
  )
}

export default ListViewDropdownE2ETab
