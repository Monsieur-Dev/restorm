import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Titlebar,
  MenuBar,
  MenuBarItem,
  MenuItem,
  MenuItemSeparator,
  Statusbar,
  ListView,
  type ListViewItemData,
  Sash,
  type IVerticalSashLayoutProvider,
  type SashEvent,
  SplitView,
  Pane,
  Button,
  useSettingsModal
} from 'electron-core-ui/renderer'
import type { WorkbenchTree, EditorTab } from 'electron-core-ui/renderer'
import { Workbench } from './components/Workbench'
import { HttpMethodBadge } from './components/HttpMethodBadge'
import { importSwaggerFromJson } from './services/SwaggerImportService'
import { folderAsRootListViewItem, collectAllFolderIds } from './services/FolderToListView'
import swaggerPetstoreJson from './resources/swagger-petstore.json'

const MIN_LEFT_WIDTH = 180
const RIGHT_MIN_WIDTH = 240

interface SidebarContextMenuItem {
  id: string
  label: string
  icon?: string
  isSeparator?: boolean
}

type TranslateFunction = (key: string) => string

const buildContextMenuForItem = (
  item: ListViewItemData,
  t: TranslateFunction
): SidebarContextMenuItem[] => {
  const hasChildren = Array.isArray(item.children) && item.children.length > 0
  const isFolder = item.isExpandable ?? hasChildren

  if (isFolder) {
    return [
      {
        id: 'create-child-folder',
        label: t('sidebar.contextMenu.createSubfolder'),
        icon: 'new-folder'
      },
      {
        id: 'define-variables',
        label: t('sidebar.contextMenu.defineVariables'),
        icon: 'symbol-variable'
      },
      { id: 'sep-folder', isSeparator: true, label: '' },
      {
        id: 'delete-folder',
        label: t('sidebar.contextMenu.delete'),
        icon: 'trash'
      }
    ]
  }

  return [
    {
      id: 'clone-item',
      label: t('sidebar.contextMenu.clone'),
      icon: 'copy'
    },
    { id: 'sep-item', isSeparator: true, label: '' },
    {
      id: 'delete-item',
      label: t('sidebar.contextMenu.delete'),
      icon: 'trash'
    }
  ]
}

const attachContextMenus = (
  items: ListViewItemData[],
  t: TranslateFunction
): ListViewItemData[] =>
  items.map((item) => {
    const withMenu = {
      ...item,
      contextMenuItems: buildContextMenuForItem(item, t)
    } as ListViewItemData
    if (item.children && item.children.length > 0) {
      withMenu.children = attachContextMenus(item.children, t)
    }
    return withMenu
  })

// Import and convert swagger to Folder structure
const swaggerFolder = importSwaggerFromJson(JSON.stringify(swaggerPetstoreJson))
const allFolderIds = collectAllFolderIds(swaggerFolder)

const App: React.FC = () => {
  const { t } = useTranslation()
  const { showSettingsModal } = useSettingsModal()

  const handleMenuExit = useCallback(() => {
    void window.api.closeWindow()
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const isMac = navigator.platform.toLowerCase().includes('mac')
      const isCtrlOrCmd = isMac ? event.metaKey : event.ctrlKey
      const key = event.key.toLowerCase()

      if (isCtrlOrCmd && key === 'q') {
        event.preventDefault()
        event.stopPropagation()
        handleMenuExit()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleMenuExit])

  // Initialize with all folders expanded
  const [expandedIds, setExpandedIds] = useState<string[]>(allFolderIds)

  // Convert swagger folder to ListView items
  const sidebarItems: ListViewItemData[] = useMemo(() => {
    const expandedSet = new Set(expandedIds)
    const rootItem = folderAsRootListViewItem(swaggerFolder, {
      expandedIds: expandedSet,
      renderMethodBadge: (method: string, name: string) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <HttpMethodBadge method={method} />
          <span>{name}</span>
        </span>
      )
    })
    return [rootItem]
  }, [expandedIds])

  const sidebarItemsWithContextMenu: ListViewItemData[] = useMemo(
    () => attachContextMenus(sidebarItems, t),
    [sidebarItems, t]
  )

  const workbenchTree: WorkbenchTree = useMemo(() => {
    const tabs: EditorTab[] = [
      {
        id: 'tab-folder-view-pet',
        title: 'pet/{petId}',
        titleString: 'pet/{petId}',
        allowFullscreen: true
      },
      {
        id: 'tab-get-pets',
        title: 'GET /pets',
        titleString: 'GET /pets',
        allowFullscreen: true
      },
      {
        id: 'tab-get-pet-by-id',
        title: 'GET /pets/{id}',
        titleString: 'GET /pets/{id}',
        allowFullscreen: true
      },
      {
        id: 'tab-create-pet',
        title: 'POST /pets',
        titleString: 'POST /pets',
        allowFullscreen: true
      }
    ]

    return {
      orientation: 'vertical',
      groups: [
        {
          id: 'restorm-main-group',
          tabs,
          activeTabId: tabs[0] ? tabs[0].id : ''
        }
      ]
    }
  }, [])

  const containerRef = useRef<HTMLDivElement | null>(null)
  const [leftWidth, setLeftWidth] = useState<number>(260)
  const [containerHeight, setContainerHeight] = useState<number>(0)
  const sashStartLeftRef = useRef<number>(leftWidth)

  const layoutProvider: IVerticalSashLayoutProvider = useMemo(
    () => ({
      getVerticalSashLeft: () => leftWidth,
      getVerticalSashTop: () => 0,
      getVerticalSashHeight: () => containerHeight
    }),
    [leftWidth, containerHeight]
  )

  const handleSashStart = useCallback(
    (_event: SashEvent): void => {
      sashStartLeftRef.current = leftWidth
    },
    [leftWidth]
  )

  const handleSashChange = useCallback(
    (event: SashEvent): void => {
      if (!containerRef.current) return

      const delta = event.currentX - event.startX
      const containerWidth = containerRef.current.clientWidth
      const min = MIN_LEFT_WIDTH
      const max = Math.max(min, containerWidth - RIGHT_MIN_WIDTH)
      const start = sashStartLeftRef.current
      const next = Math.min(max, Math.max(min, start + delta))

      setLeftWidth(next)
    },
    []
  )

  useEffect(() => {
    if (!containerRef.current) {
      return
    }
    const observer = new ResizeObserver(() => {
      const el = containerRef.current
      if (el) {
        setContainerHeight(el.clientHeight)
      }
    })
    observer.observe(containerRef.current)
    return () => {
      observer.disconnect()
    }
  }, [])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        backgroundColor: 'var(--vscode-editor-background, #1e1e1e)',
        color: 'var(--vscode-editor-foreground, #d4d4d4)'
      }}
    >
      <Titlebar
        title={t('app.title')}
        leftContent={
          <MenuBar>
            <MenuBarItem title={t('menuBar.file')}>
              <MenuItem title={t('menuBar.open')} shortcut="Ctrl+O" />
              <MenuItemSeparator />
              <MenuItem title={t('menuBar.exit')} shortcut="Ctrl+Q" onClick={handleMenuExit} />
            </MenuBarItem>
          </MenuBar>
        }
        rightContent={
          
          <Button
            small secondary
            onClick={() => { showSettingsModal() }}
            options={{
              ariaLabel: t('app.openSettings'),
              title: t('app.openSettings')
            }}
          >
            <i className="codicon codicon-gear"></i>
          </Button>
        }
      />

      <div
        ref={containerRef}
        style={{
          display: 'flex',
          position: 'relative',
          flex: 1,
          minHeight: 0
        }}
      >
        <div
          style={{
            width: leftWidth,
            minWidth: MIN_LEFT_WIDTH,
            maxWidth: '70%',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            borderRight: '1px solid var(--vscode-sideBar-border, var(--vscode-panel-border))',
            backgroundColor: 'var(--vscode-sideBar-background)'
          }}
        >
          <SplitView
            orientation="vertical"
            style={{ width: '100%', height: '100%' }}
          >
            <Pane
              title="Requests"
              collapsible={false}
              minSize={MIN_LEFT_WIDTH}
              headerActions={
                <>
                  <Button
                    secondary
                    small
                    options={{ ariaLabel: t('sidebar.addRequest'), title: t('sidebar.addRequest') }}
                    onClick={() => {
                      // TODO: hook this to real "add request" behavior
                    }}
                  >
                    <i className="codicon codicon-add" />
                  </Button>
                  <Button
                    secondary
                    small
                    options={{ ariaLabel: t('sidebar.collapseAll'), title: t('sidebar.collapseAll') }}
                    onClick={() => {
                      setExpandedIds([])
                    }}
                  >
                    <i className="codicon codicon-collapse-all" />
                  </Button>
                </>
              }
            >
              <ListView
                items={sidebarItemsWithContextMenu}
                rootRole="tree"
                ariaLabel="Requests"
                onItemToggle={(payload, expanded) => {
                  const id = payload.item.id
                  if (!id) return
                  setExpandedIds(prev =>
                    expanded
                      ? Array.from(new Set([...prev, id]))
                      : prev.filter(existingId => existingId !== id)
                  )
                }}
              />
            </Pane>
          </SplitView>
        </div>

        <div
          style={{
            flex: 1,
            minWidth: RIGHT_MIN_WIDTH,
            minHeight: 0,
            display: 'flex'
          }}
        >
          <Workbench
            tree={workbenchTree}
            style={{ flex: 1 }}
          />
        </div>

        <Sash
          orientation="vertical"
          layoutProvider={layoutProvider}
          onStart={handleSashStart}
          onChange={handleSashChange}
          size={4}
        />
      </div>

      <Statusbar />
    </div>
  )
}

export default App

