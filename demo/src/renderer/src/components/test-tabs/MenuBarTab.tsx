import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MenuBar, MenuBarItem, MenuItem, MenuItemSeparator } from 'electron-core-ui/renderer'

const MenuBarTab: React.FC = () => {
  const { t } = useTranslation()

  const [actionCount, setActionCount] = useState(0)
  const [lastAction, setLastAction] = useState('')
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true)

  const longItems = useMemo(() => {
    const items: number[] = []
    for (let i = 1; i <= 30; i += 1) items.push(i)
    return items
  }, [])

  const onAction = (id: string): void => {
    setActionCount((c) => c + 1)
    setLastAction(id)
  }

  const recent1 = t('menuBar.harness.recentFile1')
  const recent2 = t('menuBar.harness.recentFile2')

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 900, padding: 20 }}>
      <div data-testid="menubar-ready">true</div>

      <h3 style={{ fontSize: 16, marginBottom: 0 }}>{t('menuBar.harness.title')}</h3>

      <div style={{ display: 'grid', gap: 10 }}>
        <MenuBar data-testid="menubar-basic">
          <MenuBarItem data-testid="menubar-basic-file" title={t('menuBar.file')}>
            <MenuItem
              data-testid="menubar-basic-file-new"
              title={t('menuBar.new')}
              shortcut="Ctrl+Alt+N"
              onClick={() => { onAction('new') }}
            />
            <MenuItem
              data-testid="menubar-basic-file-open"
              title={t('menuBar.open')}
              shortcut="Ctrl+Alt+O"
              onClick={() => { onAction('open') }}
            />
            <MenuItem
              data-testid="menubar-basic-file-open-recent"
              title={t('menuBar.openRecent')}
            >
              <MenuItem
                data-testid="menubar-basic-file-open-recent-1"
                title={recent1}
                onClick={() => { onAction('open-recent-1') }}
              />
              <MenuItem
                data-testid="menubar-basic-file-open-recent-2"
                title={recent2}
                onClick={() => { onAction('open-recent-2') }}
              />
            </MenuItem>
            <MenuItemSeparator data-testid="menubar-basic-file-sep-1" />
            <MenuItem
              data-testid="menubar-basic-file-save"
              title={t('menuBar.save')}
              shortcut="Ctrl+Alt+S"
              onClick={() => { onAction('save') }}
            />
            <MenuItem
              data-testid="menubar-basic-file-autosave"
              title={t('menuBar.autoSave')}
              checked={autoSaveEnabled}
              onClick={() => {
                setAutoSaveEnabled((v) => !v)
                onAction('toggle-autosave')
              }}
            />
            <MenuItemSeparator data-testid="menubar-basic-file-sep-2" />
            <MenuItem
              data-testid="menubar-basic-file-revert-disabled"
              title={t('menuBar.revert')}
              disabled
              onClick={() => { onAction('revert') }}
            />
            <MenuItemSeparator data-testid="menubar-basic-file-sep-3" />
            {longItems.map((i) => (
              <MenuItem
                key={i}
                data-testid={`menubar-basic-file-long-${i}`}
                title={`${t('menuBar.harness.longItemPrefix')} ${i}`}
                onClick={() => { onAction(`long:${i}`) }}
              />
            ))}
          </MenuBarItem>

          <MenuBarItem data-testid="menubar-basic-edit" title={t('menuBar.edit')}>
            <MenuItem
              data-testid="menubar-basic-edit-undo"
              title={t('menuBar.undo')}
              shortcut="Ctrl+Alt+Z"
              onClick={() => { onAction('undo') }}
            />
            <MenuItem
              data-testid="menubar-basic-edit-redo"
              title={t('menuBar.redo')}
              shortcut="Ctrl+Alt+Y"
              onClick={() => { onAction('redo') }}
            />
          </MenuBarItem>
        </MenuBar>
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        <div data-testid="menubar-action-count">{String(actionCount)}</div>
        <div data-testid="menubar-last-action">{lastAction}</div>
        <div data-testid="menubar-autosave-enabled">{autoSaveEnabled ? 'true' : 'false'}</div>
      </div>
    </div>
  )
}

export default MenuBarTab
