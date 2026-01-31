import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ContextMenu } from 'electron-core-ui/renderer'
import type { ContextMenuItem } from 'electron-core-ui/renderer'

interface ContextMenuHarnessState {
  visible: boolean
  x: number
  y: number
}

interface ContextMenuLogState {
  lastAction: string | null
  closeCount: number
}

const ContextMenuTab: React.FC = () => {
  const { t } = useTranslation()

  const [menu, setMenu] = useState<ContextMenuHarnessState>({
    visible: false,
    x: 0,
    y: 0
  })

  const [log, setLog] = useState<ContextMenuLogState>({
    lastAction: null,
    closeCount: 0
  })

  const items = useMemo<ContextMenuItem[]>(() => {
    return [
      {
        id: 'cm-action',
        label: t('contextMenu.harness.items.action'),
        onClick: () => {
          setLog((prev) => ({ ...prev, lastAction: 'action' }))
        }
      },
      {
        id: 'cm-disabled',
        label: t('contextMenu.harness.items.disabled'),
        disabled: true,
        onClick: () => {
          setLog((prev) => ({ ...prev, lastAction: 'disabled' }))
        }
      },
      {
        id: 'cm-checked',
        label: t('contextMenu.harness.items.checked'),
        checked: true,
        onClick: () => {
          setLog((prev) => ({ ...prev, lastAction: 'checked' }))
        }
      },
      { id: 'cm-sep', label: '', isSeparator: true },
      {
        id: 'cm-icon',
        label: t('contextMenu.harness.items.icon'),
        icon: 'rocket',
        onClick: () => {
          setLog((prev) => ({ ...prev, lastAction: 'icon' }))
        }
      },
      {
        id: 'cm-submenu',
        label: t('contextMenu.harness.items.submenu'),
        items: [
          {
            id: 'cm-sub-action',
            label: t('contextMenu.harness.items.subAction'),
            onClick: () => {
              setLog((prev) => ({ ...prev, lastAction: 'subAction' }))
            }
          },
          {
            id: 'cm-sub-disabled',
            label: t('contextMenu.harness.items.subDisabled'),
            disabled: true,
            onClick: () => {
              setLog((prev) => ({ ...prev, lastAction: 'subDisabled' }))
            }
          }
        ]
      }
    ]
  }, [t])

  const handleRequestClose = useCallback((): void => {
    setMenu((prev) => ({ ...prev, visible: false }))
    setLog((prev) => ({ ...prev, closeCount: prev.closeCount + 1 }))
  }, [])

  const handleContextMenu = useCallback((event: React.MouseEvent): void => {
    event.preventDefault()
    setMenu({ visible: true, x: event.clientX, y: event.clientY })
  }, [])

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
        <h3 style={{ margin: 0 }}>{t('contextMenu.harness.title')}</h3>

        <div
          data-testid="contextmenu-target"
          onContextMenu={handleContextMenu}
          style={{
            border: '1px dashed var(--panel-border)',
            padding: 16,
            borderRadius: 4,
            userSelect: 'none'
          }}
        >
          {t('contextMenu.harness.target')}
        </div>

        <div data-testid="contextmenu-outside" style={{ height: 1, width: 1 }} />

        <ContextMenu
          data-testid="contextmenu-main"
          visible={menu.visible}
          x={menu.x}
          y={menu.y}
          items={items}
          onRequestClose={handleRequestClose}
        />

        <div style={metaGridStyle}>
          <div style={metaKeyStyle}>last action</div>
          <div data-testid="contextmenu-last-action">{log.lastAction ?? ''}</div>

          <div style={metaKeyStyle}>close count</div>
          <div data-testid="contextmenu-close-count">{String(log.closeCount)}</div>
        </div>
      </div>
    </div>
  )
}

export default ContextMenuTab
