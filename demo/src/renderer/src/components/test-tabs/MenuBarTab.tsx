import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MenuBar, MenuBarItem, MenuItem, MenuItemSeparator } from 'electron-core-ui/renderer'

const MenuBarTab: React.FC = () => {
  const { t } = useTranslation()

  const [actionCount, setActionCount] = useState(0)
  const [lastAction, setLastAction] = useState('')
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true)
  // Width of the responsive MenuBar harness — the e2e suite flips
  // this between three breakpoints to exercise the three modes.
  const [responsiveWidth, setResponsiveWidth] = useState(700)

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
        {/* Programmatic focus anchor for the roving-tabindex e2e scenarios
            only: `tabIndex={-1}` keeps it out of the real tab order, so a
            keyboard user tabbing through the actual app never lands on it —
            the e2e suite focuses it via script to get a deterministic
            "just before the bar" starting point for asserting Tab reaches
            the bar's first item. */}
        <button
          type="button"
          data-testid="menubar-basic-focus-anchor"
          aria-hidden="true"
          tabIndex={-1}
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
        />
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

      {/* Responsive harness — a six-menu MenuBar wrapped in a
          width-controllable container so the e2e suite can drive
          the three layout modes (`full` / `overflow` / `hamburger`)
          without resizing the actual window. The buttons set CSS
          width on the wrapper; the MenuBar's own ResizeObserver
          flips its `data-mode` attribute accordingly. */}
      <div style={{ display: 'grid', gap: 8, marginTop: 24 }}>
        <h3 style={{ fontSize: 16, marginBottom: 0 }}>Responsive layout</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button data-testid="responsive-width-wide" onClick={() => { setResponsiveWidth(700) }}>700 (full)</button>
          <button data-testid="responsive-width-medium" onClick={() => { setResponsiveWidth(280) }}>280 (overflow)</button>
          <button data-testid="responsive-width-narrow" onClick={() => { setResponsiveWidth(150) }}>150 (hamburger)</button>
        </div>
        <div
          data-testid="menubar-responsive-wrapper"
          style={{ width: responsiveWidth, border: '1px solid var(--panel-border, #444)', padding: 4 }}
        >
          <MenuBar data-testid="menubar-responsive" hamburgerBelowPx={200}>
            <MenuBarItem data-testid="menubar-responsive-file" title="File">
              <MenuItem data-testid="menubar-responsive-file-new" title="New" onClick={() => { onAction('r-new') }} />
            </MenuBarItem>
            <MenuBarItem data-testid="menubar-responsive-edit" title="Edit">
              <MenuItem data-testid="menubar-responsive-edit-undo" title="Undo" onClick={() => { onAction('r-undo') }} />
            </MenuBarItem>
            <MenuBarItem data-testid="menubar-responsive-selection" title="Selection">
              <MenuItem data-testid="menubar-responsive-selection-all" title="Select All" onClick={() => { onAction('r-select-all') }} />
            </MenuBarItem>
            <MenuBarItem data-testid="menubar-responsive-view" title="View">
              <MenuItem data-testid="menubar-responsive-view-zoom-in" title="Zoom In" onClick={() => { onAction('r-zoom-in') }} />
            </MenuBarItem>
            <MenuBarItem data-testid="menubar-responsive-tools" title="Tools">
              <MenuItem data-testid="menubar-responsive-tools-options" title="Options" onClick={() => { onAction('r-options') }} />
            </MenuBarItem>
            <MenuBarItem data-testid="menubar-responsive-help" title="Help">
              <MenuItem data-testid="menubar-responsive-help-about" title="About" onClick={() => { onAction('r-about') }} />
            </MenuBarItem>
          </MenuBar>
        </div>
      </div>
    </div>
  )
}

export default MenuBarTab
