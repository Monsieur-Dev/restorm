import React, { useMemo, useState, useCallback, useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import { EditorWorkbench, findGroup, isTabGroupNode, isContainerNode, logger, type ContextMenuItem } from 'electron-core-ui/renderer'
import type { EditorWorkbenchCallbacks, WorkbenchTree, EditorTab, EditorWorkbenchHandle, RebuildTabCallback } from 'electron-core-ui/renderer'
import type { RestormEditorTab, BreadcrumbItem } from '../types/editor'
import {
  isFolderTab,
  isEnvironmentFolderTab,
  isHTTPRequestTab,
  isGraphQLRequestTab,
  isGrpcRequestTab,
  isSoapRequestTab,
  isWebSocketRequestTab
} from '../types/editor'
import { EnvironmentDropdown } from './EnvironmentDropdown'
import {
  HTTPRequestTabView,
  GraphQLRequestTabView,
  GrpcRequestTabView,
  SoapRequestTabView,
  WebSocketRequestTabView 
} from './RequestTabViews'
import { EnvironmentProvider } from '../contexts/EnvironmentContext'
import { FolderView } from './FolderView'
import { EnvironmentFolderView } from './EnvironmentFolderView'
import type { EnvironmentFolder } from '../types/collections'
import { Badge } from './Badge'
import { mapToBadgeType } from '../utils/badgeUtils'
import { useTranslation } from 'react-i18next'
import { RestormWorkbenchTab } from './RestormWorkbenchTab'

/** Extract title string from EditorTab */
function getTabTitleString(tab: EditorTab & { titleString?: string }, fallback = ''): string {
  if (tab.titleString !== undefined) {
    return tab.titleString
  }
  if (typeof tab.title === 'string') {
    return tab.title
  }
  if (typeof tab.title === 'number' || typeof tab.title === 'boolean') {
    return String(tab.title)
  }
  return fallback
}

export interface RestormWorkbenchProps {
  tree: WorkbenchTree
  initialTabContentMap?: Record<string, string>
  onTreeChange?: (tree: WorkbenchTree) => void
  className?: string
  style?: React.CSSProperties
  /** ID of the group that was focused last in the workbench */
  focusedGroupId?: string | null
  /** Callback fired whenever the focused group changes */
  onFocusedGroupChange?: (groupId: string | null) => void
  /** Callback fired when a tab is activated (clicked or selected) */
  onTabActivate?: (tabId: string) => void
  /** Callback fired when a breadcrumb item is clicked (for navigation) */
  onBreadcrumbClick?: (item: BreadcrumbItem, index: number, isLast: boolean) => void
  /** Callback fired when the last breadcrumb item is renamed */
  onItemRename?: (item: BreadcrumbItem, newName: string) => void
  /** Callback fired when tags are changed for a folder or request */
  onTagsChange?: (targetId: string, tags: string[]) => void
  /** Callback fired when a folder's data changes (environments, etc.) */
  onFolderChange?: (folderId: string, folder: import('../types/collections').Folder) => void
  /** Fallback component displayed when no tabs are open */
  emptyFallback?: React.ReactNode
  /** Callback fired when group sizes change (sash dragging) */
  onSizesChange?: (nodeId: string, sizes: number[]) => void
  /** Unique identifier for workbench persistence (required if autosave is enabled) */
  workbenchId?: string
  /** Enable automatic save/load of workbench state */
  autosave?: boolean
  /** Callback to rebuild a tab from its ID (required if autosave is enabled) */
  onRebuildTab?: RebuildTabCallback
  /** Called when state is restored from storage */
  onStateRestored?: (tree: WorkbenchTree | null) => void
  /** Get a reactive Request by ID (for reactivity support) */
  getRequestById?: (id: string) => import('../types/collections').Request | undefined
  /** Get a reactive Folder by ID (for reactivity support) */
  getFolderById?: (id: string) => import('../types/collections').Folder | undefined
  /** Get a reactive EnvironmentFolder by ID (for reactivity support) */
  getEnvironmentFolderById?: (id: string) => EnvironmentFolder | undefined
  /** Callback fired when an environment folder's data changes */
  onEnvironmentFolderChange?: (folderId: string, folder: EnvironmentFolder) => void
}

/** Imperative handle for Workbench component */
export interface RestormWorkbenchHandle {
  saveState: () => Promise<boolean>
  loadState: () => Promise<WorkbenchTree | null>
  clearState: () => Promise<boolean>
}

const EditorWorkbenchAny = EditorWorkbench as unknown as React.ForwardRefExoticComponent<Record<string, unknown> & React.RefAttributes<EditorWorkbenchHandle>>

/** Wrapper component for EditorWorkbench that handles restorm-specific tab rendering */
export const RestormWorkbench = forwardRef<RestormWorkbenchHandle, RestormWorkbenchProps>(({
  tree: initialTree,
  onTreeChange,
  className,
  style,
  focusedGroupId,
  onFocusedGroupChange,
  onTabActivate,
  onBreadcrumbClick,
  onItemRename,
  onTagsChange,
  onFolderChange,
  onEnvironmentFolderChange,
  emptyFallback,
  onSizesChange,
  workbenchId,
  autosave,
  onRebuildTab,
  onStateRestored,
  getRequestById,
  getFolderById,
  getEnvironmentFolderById
}, ref) => {
  const { t } = useTranslation()
  const editorWorkbenchRef = useRef<EditorWorkbenchHandle>(null)
  const isControlled = onTreeChange !== undefined
  const [localTree, setLocalTree] = useState<WorkbenchTree>(initialTree)
  const tree = isControlled ? initialTree : localTree
  const lastTabCountRef = useRef<number>(0)
  const lastActiveTabIdRef = useRef<string | null>(null)
  
  // Expose imperative handle
  useImperativeHandle(ref, () => ({
    saveState: async () => editorWorkbenchRef.current?.saveState() ?? false,
    loadState: async () => editorWorkbenchRef.current?.loadState() ?? null,
    clearState: async () => editorWorkbenchRef.current?.clearState() ?? false
  }), [])

  useEffect(() => {
    if (!isControlled) {
      setLocalTree(initialTree)
    }
  }, [initialTree, isControlled])

  const handleTabDropped = useCallback(
    (_tabData: { tabId: string; title: string; groupId: string; content?: string; cursorX?: number; cursorY?: number }): boolean | Promise<boolean> => {
      return true
    },
    []
  )

  // Render tab title with icon and HTTP method badge (if applicable)
  const renderTabTitle = useCallback((tab: EditorTab): React.ReactNode => {
    const restormTab = tab as RestormEditorTab

    // Folder tab: show folder icon
    if (isFolderTab(restormTab)) {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <i className="codicon codicon-folder-opened" aria-hidden="true" />
          <span>{restormTab.folder.name}</span>
        </span>
      )
    }

    // Environment folder tab: show folder-library icon
    if (isEnvironmentFolderTab(restormTab)) {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <i className="codicon codicon-folder-library" aria-hidden="true" />
          <span>{restormTab.folder.name}</span>
        </span>
      )
    }

    // HTTP request tab: show method badge
    if (isHTTPRequestTab(restormTab)) {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Badge type={mapToBadgeType(restormTab.request.method)} />
          <span>{restormTab.request.name}</span>
        </span>
      )
    }

    // GraphQL request tab
    if (isGraphQLRequestTab(restormTab)) {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Badge type="GQL" />
          <span>{restormTab.request.name}</span>
        </span>
      )
    }

    // gRPC request tab
    if (isGrpcRequestTab(restormTab)) {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Badge type={mapToBadgeType(restormTab.request.callType)} />
          <span>{restormTab.request.name}</span>
        </span>
      )
    }

    // SOAP request tab
    if (isSoapRequestTab(restormTab)) {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Badge type="SOAP" />
          <span>{restormTab.request.name}</span>
        </span>
      )
    }

    // WebSocket request tab
    if (isWebSocketRequestTab(restormTab)) {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Badge type={mapToBadgeType(restormTab.request.protocol)} />
          <span>{restormTab.request.name}</span>
        </span>
      )
    }

    return null
  }, [])

  // Render tab content based on tab type
  const renderTabContent = useCallback((tab: RestormEditorTab): React.ReactNode => {
    const breadcrumbs = tab.breadcrumbs ?? [
      { id: 'root', label: 'Swagger Petstore' }
    ]

    // Folder tab
    if (isFolderTab(tab)) {
      // Get reactive folder if available, otherwise use tab's copy
      const folder = getFolderById?.(tab.folder.id) ?? tab.folder
      return (
        <RestormWorkbenchTab
          breadcrumbs={breadcrumbs}
          onBreadcrumbClick={onBreadcrumbClick}
          onBreadcrumbRename={onItemRename}
          tags={folder.tags}
          onTagsChange={(nextTags) => {
            onTagsChange?.(folder.id, nextTags)
          }}
          label={t('workbench.tagsLabel')}
        >
          <FolderView
            folder={folder}
            onFolderChange={(updatedFolder) => {
              if (onFolderChange) {
                onFolderChange(folder.id, updatedFolder)
              }
            }}
          />
        </RestormWorkbenchTab>
      )
    }

    // Environment folder tab
    if (isEnvironmentFolderTab(tab)) {
      // Get reactive environment folder if available, otherwise use tab's copy
      const folder = getEnvironmentFolderById?.(tab.folder.id) ?? tab.folder
      return (
        <RestormWorkbenchTab
          breadcrumbs={breadcrumbs}
          onBreadcrumbClick={onBreadcrumbClick}
          onBreadcrumbRename={onItemRename}
          tags={folder.tags}
          onTagsChange={(nextTags) => {
            onTagsChange?.(folder.id, nextTags)
          }}
          label={t('workbench.tagsLabel')}
        >
          <EnvironmentFolderView
            folder={folder}
            onFolderChange={(updatedFolder) => {
              if (onEnvironmentFolderChange) {
                onEnvironmentFolderChange(folder.id, updatedFolder)
              }
            }}
          />
        </RestormWorkbenchTab>
      )
    }

    // HTTP request tab
    if (isHTTPRequestTab(tab)) {
      // Get reactive request if available, otherwise use tab's copy
      const reactiveRequest = getRequestById?.(tab.request.id)
      const request = (reactiveRequest && reactiveRequest.type === 'http') ? reactiveRequest : tab.request
      return (
        <EnvironmentProvider environments={tab.environments}>
          <RestormWorkbenchTab
            breadcrumbs={breadcrumbs}
            onBreadcrumbClick={onBreadcrumbClick}
            onBreadcrumbRename={onItemRename}
            tags={request.tags}
            onTagsChange={(nextTags) => {
              onTagsChange?.(request.id, nextTags)
            }}
            label={t('workbench.tagsLabel')}
            headerRight={<EnvironmentDropdown />}
            callout={request.deprecated ? {
              variant: 'warning',
              message: t('requestTab.deprecated')
            } : undefined}
          >
            <div style={{ flex: 1, minHeight: 0, minWidth: 0, padding: '8px 16px' }}>
              <HTTPRequestTabView request={request} />
            </div>
          </RestormWorkbenchTab>
        </EnvironmentProvider>
      )
    }

    // GraphQL request tab
    if (isGraphQLRequestTab(tab)) {
      const request = tab.request
      return (
        <EnvironmentProvider environments={tab.environments}>
          <RestormWorkbenchTab
            breadcrumbs={breadcrumbs}
            onBreadcrumbClick={onBreadcrumbClick}
            onBreadcrumbRename={onItemRename}
            tags={request.tags}
            onTagsChange={(nextTags) => {
              onTagsChange?.(request.id, nextTags)
            }}
            label={t('workbench.tagsLabel')}
            headerRight={<EnvironmentDropdown />}
          >
            <div style={{ flex: 1, minHeight: 0, minWidth: 0, padding: '8px 16px' }}>
              <GraphQLRequestTabView request={request} />
            </div>
          </RestormWorkbenchTab>
        </EnvironmentProvider>
      )
    }

    // gRPC request tab
    if (isGrpcRequestTab(tab)) {
      const request = tab.request
      return (
        <EnvironmentProvider environments={tab.environments}>
          <RestormWorkbenchTab
            breadcrumbs={breadcrumbs}
            onBreadcrumbClick={onBreadcrumbClick}
            onBreadcrumbRename={onItemRename}
            tags={request.tags}
            onTagsChange={(nextTags) => {
              onTagsChange?.(request.id, nextTags)
            }}
            label={t('workbench.tagsLabel')}
            headerRight={<EnvironmentDropdown />}
          >
            <div style={{ flex: 1, minHeight: 0, minWidth: 0, padding: '8px 16px' }}>
              <GrpcRequestTabView request={request} />
            </div>
          </RestormWorkbenchTab>
        </EnvironmentProvider>
      )
    }

    // SOAP request tab
    if (isSoapRequestTab(tab)) {
      const request = tab.request
      return (
        <EnvironmentProvider environments={tab.environments}>
          <RestormWorkbenchTab
            breadcrumbs={breadcrumbs}
            onBreadcrumbClick={onBreadcrumbClick}
            onBreadcrumbRename={onItemRename}
            tags={request.tags}
            onTagsChange={(nextTags) => {
              onTagsChange?.(request.id, nextTags)
            }}
            label={t('workbench.tagsLabel')}
            headerRight={<EnvironmentDropdown />}
          >
            <div style={{ flex: 1, minHeight: 0, minWidth: 0, padding: '8px 16px' }}>
              <SoapRequestTabView request={request} />
            </div>
          </RestormWorkbenchTab>
        </EnvironmentProvider>
      )
    }

    // WebSocket request tab
    if (isWebSocketRequestTab(tab)) {
      const request = tab.request
      return (
        <EnvironmentProvider environments={tab.environments}>
          <RestormWorkbenchTab
            breadcrumbs={breadcrumbs}
            onBreadcrumbClick={onBreadcrumbClick}
            onBreadcrumbRename={onItemRename}
            tags={request.tags}
            onTagsChange={(nextTags) => {
              onTagsChange?.(request.id, nextTags)
            }}
            label={t('workbench.tagsLabel')}
            headerRight={<EnvironmentDropdown />}
          >
            <div style={{ flex: 1, minHeight: 0, minWidth: 0, padding: '8px 16px' }}>
              <WebSocketRequestTabView request={request} />
            </div>
          </RestormWorkbenchTab>
        </EnvironmentProvider>
      )
    }

    // Legacy/empty tab fallback (should not happen with typed tabs)
    return null
  }, [onBreadcrumbClick, onItemRename, onTagsChange, onFolderChange, onEnvironmentFolderChange, t, getRequestById, getFolderById, getEnvironmentFolderById])

  // Handle tab detach to new window
  const handleDetachToNewWindow = useCallback(
    (tabId: string, groupId: string, cursorX?: number, cursorY?: number): void => {
      const groupResult = findGroup(tree, groupId)
      if (!groupResult.node || !isTabGroupNode(groupResult.node)) {
        logger.error('Group not found for detach', { groupId })
        return
      }

      const tab = groupResult.node.tabs.find((t: EditorTab) => t.id === tabId)
      if (!tab) {
        logger.error('Tab not found for detach', { tabId, groupId })
        return
      }

      const restormTab = tab as RestormEditorTab

      // Encode minimal metadata so the editor window can rebuild the tab
      type DetachedTabMetadata =
        | { kind: 'folder'; itemId: string }
        | { kind: 'environment-folder'; itemId: string }
        | { kind: 'http-request'; itemId: string }

      let metadata: DetachedTabMetadata | null = null

      if (isFolderTab(restormTab)) {
        metadata = { kind: 'folder', itemId: restormTab.folder.id }
      } else if (isEnvironmentFolderTab(restormTab)) {
        metadata = { kind: 'environment-folder', itemId: restormTab.folder.id }
      } else if (isHTTPRequestTab(restormTab)) {
        metadata = { kind: 'http-request', itemId: restormTab.request.id }
      }

      const editorParams: { title: string; content?: string; x?: number; y?: number } = {
        title: getTabTitleString(restormTab, 'untitled')
      }
      if (metadata) {
        editorParams.content = JSON.stringify(metadata)
      }
      if (cursorX !== undefined) {
        editorParams.x = cursorX
      }
      if (cursorY !== undefined) {
        editorParams.y = cursorY
      }
      void window.restorm.openEditor(editorParams)
    },
    [tree]
  )

  const getTabContextMenuItems = useCallback(
    (_tab: EditorTab, _groupId: string, actions: { close: () => void; closeOthersInGroup: () => void }): ContextMenuItem[] => {
      const items: ContextMenuItem[] = [
        {
          id: 'close',
          label: t('workbench.tabContextMenu.close'),
          icon: 'close',
          onClick: actions.close
        },
        {
          id: 'close-others',
          label: t('workbench.tabContextMenu.closeOthers'),
          icon: 'close-all',
          onClick: actions.closeOthersInGroup
        }
      ]

      return items
    },
    [t]
  )

  const workbenchRenderTabContent = useMemo(() => {
    return (tab: unknown): React.ReactNode => {
      const baseTab = tab as RestormEditorTab
      return renderTabContent(baseTab)
    }
  }, [renderTabContent])

  const callbacks = useMemo<Partial<EditorWorkbenchCallbacks>>(() => {
    return {
      onWorkbenchTabDropped: handleTabDropped,
      renderTabContent: workbenchRenderTabContent,
      renderTabTitle,
      onDetachToNewWindow: handleDetachToNewWindow,
      getTabContextMenuItems
    }
  }, [handleTabDropped, workbenchRenderTabContent, renderTabTitle, handleDetachToNewWindow, getTabContextMenuItems])

  const handleTreeChange = useCallback(
    (newTree: WorkbenchTree) => {
      const tabCount = newTree.groups.reduce((total, node) => {
        if (isTabGroupNode(node)) {
          return total + node.tabs.length
        }
        if (isContainerNode(node)) {
          const countRecursive = (n: typeof node): number => {
            return n.groups.reduce((sum, child) => {
              if (isTabGroupNode(child)) {
                return sum + child.tabs.length
              }
              if (isContainerNode(child)) {
                return sum + countRecursive(child)
              }
              return sum
            }, 0)
          }
          return total + countRecursive(node)
        }
        return total
      }, 0)

      lastTabCountRef.current = tabCount

      // Detect active tab change and notify
      const firstGroup = newTree.groups[0]
      const newActiveTabId = firstGroup && isTabGroupNode(firstGroup) ? firstGroup.activeTabId : null
      if (newActiveTabId && newActiveTabId !== lastActiveTabIdRef.current) {
        lastActiveTabIdRef.current = newActiveTabId
        onTabActivate?.(newActiveTabId)
      }

      if (isControlled) {
        onTreeChange(newTree)
      } else {
        setLocalTree(newTree)
      }
    },
    [onTreeChange, isControlled, onTabActivate]
  )

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', flex: 1, ...style }}
      className={className}
    >
      <EditorWorkbenchAny
        ref={editorWorkbenchRef}
        tree={tree}
        onChange={handleTreeChange}
        focusedGroupId={focusedGroupId ?? undefined}
        onFocusedGroupChange={onFocusedGroupChange}
        emptyFallback={emptyFallback}
        onSizesChange={onSizesChange}
        workbenchId={workbenchId}
        autosave={autosave}
        onRebuildTab={onRebuildTab}
        onStateRestored={onStateRestored}
        {...callbacks}
      />
    </div>
  )
})

RestormWorkbench.displayName = 'RestormWorkbench'

export default RestormWorkbench
