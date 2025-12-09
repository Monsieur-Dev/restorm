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
import type { WorkbenchTree, EditorTab, ContextMenuItem } from 'electron-core-ui/renderer'
import { Workbench } from './components/Workbench'
import { HttpMethodBadge } from './components/HttpMethodBadge'

const MIN_LEFT_WIDTH = 180
const RIGHT_MIN_WIDTH = 240

const buildContextMenuForItem = (item: ListViewItemData): ContextMenuItem[] => {
  const hasChildren = Array.isArray(item.children) && item.children.length > 0
  const isFolder = item.isExpandable ?? hasChildren

  if (isFolder) {
    return [
      {
        id: 'create-child-folder',
        label: 'Créer un sous-dossier',
        icon: 'new-folder'
      },
      {
        id: 'define-variables',
        label: 'Définir les variables',
        icon: 'symbol-variable'
      },
      { id: 'sep-folder', isSeparator: true, label: '' },
      {
        id: 'delete-folder',
        label: 'Supprimer',
        icon: 'trash'
      }
    ]
  }

  return [
    {
      id: 'clone-item',
      label: 'Cloner',
      icon: 'copy'
    },
    { id: 'sep-item', isSeparator: true, label: '' },
    {
      id: 'delete-item',
      label: 'Supprimer',
      icon: 'trash'
    }
  ]
}

const attachContextMenus = (items: ListViewItemData[]): ListViewItemData[] =>
  items.map((item) => {
    const withMenu: ListViewItemData = {
      ...item,
      contextMenuItems: buildContextMenuForItem(item)
    }
    if (item.children && item.children.length > 0) {
      withMenu.children = attachContextMenus(item.children)
    }
    return withMenu
  })

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

  const [expandedIds, setExpandedIds] = useState<string[]>([
    'pet-root',
    'pet-id-folder',
    'pet-upload-image',
    'find-by-status',
    'find-by-tags',
    'store-root',
    'inventory-folder',
    'order-folder',
    'order-id-folder',
    'user-root',
    'create-with-list-folder',
    'username-folder',
    'login-folder',
    'logout-folder',
    'create-with-array-folder'
  ])

  const sidebarItems: ListViewItemData[] = useMemo(
    () => [
      {
        id: 'pet-root',
        title: 'pet',
        isExpandable: true,
        isExpanded: expandedIds.includes('pet-root'),
        icon: expandedIds.includes('pet-root') ? 'folder-opened' : 'folder',
        children: [
          {
            id: 'pet-id-folder',
            title: '{petId}',
            isExpandable: true,
            isExpanded: expandedIds.includes('pet-id-folder'),
            icon: expandedIds.includes('pet-id-folder') ? 'folder-opened' : 'folder',
            children: [
              {
                id: 'pet-upload-image',
                title: 'uploadImage',
                isExpandable: true,
                isExpanded: expandedIds.includes('pet-upload-image'),
                icon: expandedIds.includes('pet-upload-image') ? 'folder-opened' : 'folder',
                children: [
                  {
                    id: 'get-find-pet-by-id',
                    title: (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <HttpMethodBadge method="GET" />
                        <span>Find pet by ID</span>
                      </span>
                ),
                icon: 'blank'
                  },
                  {
                    id: 'post-updates-pet-form-data',
                    title: (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <HttpMethodBadge method="POST" />
                        <span>Updates a pet in the store with form data</span>
                      </span>
                ),
                icon: 'blank'
                  },
                  {
                    id: 'delete-delete-pet',
                    title: (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <HttpMethodBadge method="DELETE" />
                        <span>Deletes a pet</span>
                      </span>
                ),
                icon: 'blank'
                  }
                ]
              }
            ]
          },
          {
            id: 'find-by-status',
            title: 'findByStatus',
            isExpandable: true,
            isExpanded: expandedIds.includes('find-by-status'),
            icon: expandedIds.includes('find-by-status') ? 'folder-opened' : 'folder',
            children: [
              {
                id: 'get-finds-pets-by-status',
                title: (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <HttpMethodBadge method="GET" />
                    <span>Finds Pets by status</span>
                  </span>
                ),
                icon: 'blank'
              }
            ]
          },
          {
            id: 'find-by-tags',
            title: 'findByTags',
            isExpandable: true,
            isExpanded: expandedIds.includes('find-by-tags'),
            icon: expandedIds.includes('find-by-tags') ? 'folder-opened' : 'folder',
            children: [
              {
                id: 'get-finds-pets-by-tags',
                title: (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <HttpMethodBadge method="GET" />
                    <span>Finds Pets by tags</span>
                  </span>
                ),
                icon: 'blank'
              }
            ]
          },
          {
            id: 'post-add-new-pet',
            title: (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <HttpMethodBadge method="POST" />
                <span>Add a new pet to the store</span>
              </span>
            ),
            icon: 'blank'
          },
          {
            id: 'put-update-existing-pet',
            title: (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <HttpMethodBadge method="PUT" />
                <span>Update an existing pet</span>
              </span>
            ),
            icon: 'blank'
          }
        ]
      },
      {
        id: 'store-root',
        title: 'store',
        isExpandable: true,
        isExpanded: expandedIds.includes('store-root'),
        icon: expandedIds.includes('store-root') ? 'folder-opened' : 'folder',
        children: [
          {
            id: 'inventory-folder',
            title: 'inventory',
            isExpandable: true,
            isExpanded: expandedIds.includes('inventory-folder'),
            icon: expandedIds.includes('inventory-folder') ? 'folder-opened' : 'folder',
            children: [
              {
                id: 'get-inventory-by-status',
                title: (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <HttpMethodBadge method="GET" />
                    <span>Returns pet inventories by status</span>
                  </span>
                ),
                icon: 'blank'
              }
            ]
          },
          {
            id: 'order-folder',
            title: 'order',
            isExpandable: true,
            isExpanded: expandedIds.includes('order-folder'),
            icon: expandedIds.includes('order-folder') ? 'folder-opened' : 'folder',
            children: [
              {
                id: 'order-id-folder',
                title: '{orderId}',
                isExpandable: true,
                isExpanded: expandedIds.includes('order-id-folder'),
                icon: expandedIds.includes('order-id-folder') ? 'folder-opened' : 'folder',
                children: [
                  {
                    id: 'get-find-order-by-id',
                    title: (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <HttpMethodBadge method="GET" />
                        <span>Find purchase order by ID</span>
                      </span>
                ),
                icon: 'blank'
                  },
                  {
                    id: 'delete-delete-order-by-id',
                    title: (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <HttpMethodBadge method="DELETE" />
                        <span>Delete purchase order by ID</span>
                      </span>
                ),
                icon: 'blank'
                  }
                ]
              }
            ]
          },
          {
            id: 'post-place-order',
            title: (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <HttpMethodBadge method="POST" />
                <span>Place an order for a pet</span>
              </span>
            ),
            icon: 'blank'
          }
        ]
      },
      {
        id: 'user-root',
        title: 'user',
        isExpandable: true,
        isExpanded: expandedIds.includes('user-root'),
        icon: expandedIds.includes('user-root') ? 'folder-opened' : 'folder',
        children: [
          {
            id: 'create-with-list-folder',
            title: 'createWithList',
            isExpandable: true,
            isExpanded: expandedIds.includes('create-with-list-folder'),
            icon: expandedIds.includes('create-with-list-folder') ? 'folder-opened' : 'folder',
            children: [
              {
                id: 'post-create-users-with-list',
                title: (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <HttpMethodBadge method="POST" />
                    <span>Creates list of users with given input array</span>
                  </span>
                ),
                icon: 'blank'
              }
            ]
          },
          {
            id: 'username-folder',
            title: '{username}',
            isExpandable: true,
            isExpanded: expandedIds.includes('username-folder'),
            icon: expandedIds.includes('username-folder') ? 'folder-opened' : 'folder',
            children: [
              {
                id: 'get-user-by-name',
                title: (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <HttpMethodBadge method="GET" />
                    <span>Get user by user name</span>
                  </span>
                ),
                icon: 'blank'
              },
              {
                id: 'put-update-user',
                title: (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <HttpMethodBadge method="PUT" />
                    <span>Updated user</span>
                  </span>
                ),
                icon: 'blank'
              },
              {
                id: 'delete-delete-user',
                title: (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <HttpMethodBadge method="DELETE" />
                    <span>Delete user</span>
                  </span>
                ),
                icon: 'blank'
              }
            ]
          },
          {
            id: 'login-folder',
            title: 'login',
            isExpandable: true,
            isExpanded: expandedIds.includes('login-folder'),
            icon: expandedIds.includes('login-folder') ? 'folder-opened' : 'folder',
            children: [
              {
                id: 'get-login',
                title: (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <HttpMethodBadge method="GET" />
                    <span>Logs user into the system</span>
                  </span>
                ),
                icon: 'blank'
              }
            ]
          },
          {
            id: 'logout-folder',
            title: 'logout',
            isExpandable: true,
            isExpanded: expandedIds.includes('logout-folder'),
            icon: expandedIds.includes('logout-folder') ? 'folder-opened' : 'folder',
            children: [
              {
                id: 'get-logout',
                title: (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <HttpMethodBadge method="GET" />
                    <span>Logs out current logged in user session</span>
                  </span>
                ),
                icon: 'blank'
              }
            ]
          },
          {
            id: 'create-with-array-folder',
            title: 'createWithArray',
            isExpandable: true,
            isExpanded: expandedIds.includes('create-with-array-folder'),
            icon: expandedIds.includes('create-with-array-folder') ? 'folder-opened' : 'folder',
            children: [
              {
                id: 'post-create-users-with-array',
                title: (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <HttpMethodBadge method="POST" />
                    <span>Creates list of users with given input array</span>
                  </span>
                ),
                icon: 'blank'
              }
            ]
          },
          {
            id: 'post-create-user',
            title: (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <HttpMethodBadge method="POST" />
                <span>Create user</span>
              </span>
            ),
            icon: 'blank'
          }
        ]
      }
    ],
    [expandedIds]
  )

  const sidebarItemsWithContextMenu: ListViewItemData[] = useMemo(
    () => attachContextMenus(sidebarItems),
    [sidebarItems]
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
        backgroundColor: 'var(--ecui-editor-background, #1e1e1e)',
        color: 'var(--ecui-editor-foreground, #d4d4d4)'
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
              ariaLabel: 'Open settings',
              title: 'Open settings'
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
            borderRight: '1px solid var(--ecui-sideBar-border, var(--ecui-panel-border))',
            backgroundColor: 'var(--ecui-sideBar-background)'
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
                    options={{ ariaLabel: 'Add request', title: 'Add request' }}
                    onClick={() => {
                      // TODO: hook this to real "add request" behavior
                    }}
                  >
                    <i className="codicon codicon-add" />
                  </Button>
                  <Button
                    secondary
                    small
                    options={{ ariaLabel: 'Collapse all requests', title: 'Collapse all requests' }}
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

