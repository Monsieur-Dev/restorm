import React, { useMemo, useState, useCallback, useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import { EditorWorkbench, findGroup, isTabGroupNode, isContainerNode, logger, type ContextMenuItem } from 'electron-core-ui/renderer'
import type { EditorWorkbenchCallbacks, WorkbenchTree, EditorTab, EditorWorkbenchHandle, RebuildTabCallback } from 'electron-core-ui/renderer'
import type { RestormEditorTab, BreadcrumbItem } from '../../../types/editor'
import {
  isFolderTab,
  isEnvironmentFolderTab,
  isHTTPRequestTab,
  isGraphQLRequestTab,
  isGrpcRequestTab,
  isSoapRequestTab,
  isWebSocketRequestTab
} from '../../../types/editor'
import { EnvironmentDropdown } from './EnvironmentDropdown'
import {
  HTTPRequestTabView,
  GraphQLRequestTabView,
  GrpcRequestTabView,
  SoapRequestTabView,
  WebSocketRequestTabView 
} from '../../RequestTabViews'
import { EnvironmentProvider } from '../../../contexts/EnvironmentContext'
import { FolderView } from '../../Folders/FolderView'
import { EnvironmentFolderView } from '../../Folders/EnvironmentFolderView'
import type { EnvironmentFolder, Folder, Request } from '../../../types/collections'
import { Badge } from '../../common/Badge'
import { mapToBadgeType } from '../../../utils/badgeUtils'
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
  dirtyItemIdsSet?: Set<string>
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
  onFolderChange?: (folderId: string, folder: Folder) => void
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
  getRequestById?: (id: string) => Request | undefined
  /** Get a reactive Folder by ID (for reactivity support) */
  getFolderById?: (id: string) => Folder | undefined
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
  dirtyItemIdsSet,
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
  
  // Cache for tabs dropped from other windows (stores the full RestormEditorTab data)
  const droppedTabsCacheRef = useRef<Map<string, RestormEditorTab>>(new Map())
  
  // Expose imperative handle
  useImperativeHandle(ref, () => ({
    saveState: async () => editorWorkbenchRef.current?.saveState() ?? false,
    loadState: async () => editorWorkbenchRef.current?.loadState() ?? null,
    clearState: async () => editorWorkbenchRef.current?.clearState() ?? false
  }), [])

  useEffect(() => {
    if (!isControlled) {
      const rafId = requestAnimationFrame(() => {
        setLocalTree(initialTree)
      })
      return (): void => { cancelAnimationFrame(rafId) }
    }
    return undefined
  }, [initialTree, isControlled])

  const handleTabDropped = useCallback(
    (tabData: { tabId: string; title: string; groupId: string; content?: string; cursorX?: number; cursorY?: number }): boolean | Promise<boolean> => {
      // Parse the content JSON to get the full RestormEditorTab and cache it
      if (tabData.content) {
        try {
          const restoredTab = JSON.parse(tabData.content) as RestormEditorTab
          droppedTabsCacheRef.current.set(tabData.tabId, restoredTab)
        } catch (error) {
          logger.error('Failed to parse dropped tab content', { tabId: tabData.tabId, error: String(error) })
          return false
        }
      }
      return true
    },
    []
  )

  // Render tab title with icon and HTTP method badge (if applicable)
  const getTabItemId = useCallback((tab: RestormEditorTab): string | null => {
    if (isFolderTab(tab) || isEnvironmentFolderTab(tab)) {
      return tab.folder.id
    }
    if (
      isHTTPRequestTab(tab) ||
      isGraphQLRequestTab(tab) ||
      isGrpcRequestTab(tab) ||
      isSoapRequestTab(tab) ||
      isWebSocketRequestTab(tab)
    ) {
      return tab.request.id
    }
    return null
  }, [])

  const renderDirtyIndicator = useCallback((tab: RestormEditorTab): React.ReactNode => {
    const itemId = getTabItemId(tab)
    if (!itemId || !dirtyItemIdsSet?.has(itemId)) return null
    return (
      <span
        className="codicon codicon-circle-filled dirty-indicator"
        aria-label="Modified"
        title="Modified"
        style={{ marginLeft: 6 }}
      />
    )
  }, [dirtyItemIdsSet, getTabItemId])

  const renderTabTitle = useCallback((tab: EditorTab): React.ReactNode => {
    // Check if this is a dropped tab with cached data
    const cachedTab = droppedTabsCacheRef.current.get(tab.id)
    const restormTab = cachedTab ?? (tab as RestormEditorTab)

    // Folder tab: show folder icon
    if (isFolderTab(restormTab)) {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <i className="codicon codicon-folder-opened" aria-hidden="true" />
          <span>{restormTab.folder.name}</span>
          {renderDirtyIndicator(restormTab)}
        </span>
      )
    }

    // Environment folder tab: show folder-library icon
    if (isEnvironmentFolderTab(restormTab)) {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <i className="codicon codicon-folder-library" aria-hidden="true" />
          <span>{restormTab.folder.name}</span>
          {renderDirtyIndicator(restormTab)}
        </span>
      )
    }

    // HTTP request tab: show method badge
    if (isHTTPRequestTab(restormTab)) {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Badge type={mapToBadgeType(restormTab.request.method)} />
          <span>{restormTab.request.name}</span>
          {renderDirtyIndicator(restormTab)}
        </span>
      )
    }

    // GraphQL request tab
    if (isGraphQLRequestTab(restormTab)) {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Badge type="GQL" />
          <span>{restormTab.request.name}</span>
          {renderDirtyIndicator(restormTab)}
        </span>
      )
    }

    // gRPC request tab
    if (isGrpcRequestTab(restormTab)) {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Badge type={mapToBadgeType(restormTab.request.callType)} />
          <span>{restormTab.request.name}</span>
          {renderDirtyIndicator(restormTab)}
        </span>
      )
    }

    // SOAP request tab
    if (isSoapRequestTab(restormTab)) {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Badge type="SOAP" />
          <span>{restormTab.request.name}</span>
          {renderDirtyIndicator(restormTab)}
        </span>
      )
    }

    // WebSocket request tab
    if (isWebSocketRequestTab(restormTab)) {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Badge type={mapToBadgeType(restormTab.request.protocol)} />
          <span>{restormTab.request.name}</span>
          {renderDirtyIndicator(restormTab)}
        </span>
      )
    }

    return null
  }, [renderDirtyIndicator])

  // Render tab content based on tab type
  const renderTabContent = useCallback((tab: RestormEditorTab): React.ReactNode => {
    // Check if this is a dropped tab with cached data
    const cachedTab = droppedTabsCacheRef.current.get(tab.id)
    const effectiveTab = cachedTab ?? tab
    
    const breadcrumbs = effectiveTab.breadcrumbs ?? [
      { id: 'root', label: 'Root' }
    ]

    // Folder tab
    if (isFolderTab(effectiveTab)) {
      // Get reactive folder if available, otherwise use tab's copy
      const folder = getFolderById?.(effectiveTab.folder.id) ?? effectiveTab.folder
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
            onFolderChange={(updatedFolder: Folder) => {
              if (onFolderChange) {
                onFolderChange(folder.id, updatedFolder)
              }
            }}
          />
        </RestormWorkbenchTab>
      )
    }

    // Environment folder tab
    if (isEnvironmentFolderTab(effectiveTab)) {
      // Get reactive environment folder if available, otherwise use tab's copy
      const reactiveFolder = getEnvironmentFolderById?.(effectiveTab.folder.id)
      const folder = reactiveFolder ?? effectiveTab.folder
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
    if (isHTTPRequestTab(effectiveTab)) {
      // Get reactive request if available, otherwise use tab's copy
      const reactiveRequest = getRequestById?.(effectiveTab.request.id)
      const request = (reactiveRequest?.type === 'http') ? reactiveRequest : effectiveTab.request
      return (
        <EnvironmentProvider environments={effectiveTab.environments}>
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
    if (isGraphQLRequestTab(effectiveTab)) {
      const request = effectiveTab.request
      return (
        <EnvironmentProvider environments={effectiveTab.environments}>
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
    if (isGrpcRequestTab(effectiveTab)) {
      const request = effectiveTab.request
      return (
        <EnvironmentProvider environments={effectiveTab.environments}>
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
    if (isSoapRequestTab(effectiveTab)) {
      const request = effectiveTab.request
      return (
        <EnvironmentProvider environments={effectiveTab.environments}>
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
    if (isWebSocketRequestTab(effectiveTab)) {
      const request = effectiveTab.request
      return (
        <EnvironmentProvider environments={effectiveTab.environments}>
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

      // Check if this tab was dropped from another window and use cached data
      const cachedTab = droppedTabsCacheRef.current.get(tabId)
      const restormTab = cachedTab ?? (tab as RestormEditorTab)

      // Serialize the complete tab data so the editor window can display it directly
      const editorParams: { title: string; content?: string; x?: number; y?: number } = {
        title: getTabTitleString(restormTab, 'untitled'),
        // Pass the complete tab as JSON - the editor window will deserialize and display it
        content: JSON.stringify(restormTab)
      }
      if (cursorX !== undefined) {
        editorParams.x = cursorX
      }
      if (cursorY !== undefined) {
        editorParams.y = cursorY
      }
      void window.restorm?.openEditor(editorParams)
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

  // Get tab content for serialization (used when detaching tabs to other windows)
  const getTabContent = useCallback((tabId: string): string | undefined => {
    // First check in dropped tabs cache
    const cachedTab = droppedTabsCacheRef.current.get(tabId)
    if (cachedTab) {
      return JSON.stringify(cachedTab)
    }

    // Search for the tab in the tree
    const findTabInTree = (nodes: typeof tree.groups): RestormEditorTab | undefined => {
      for (const node of nodes) {
        if (isTabGroupNode(node)) {
          const tab = node.tabs.find(t => t.id === tabId)
          if (tab) {
            return tab as RestormEditorTab
          }
        } else if (isContainerNode(node)) {
          const found = findTabInTree(node.groups)
          if (found) return found
        }
      }
      return undefined
    }

    const tab = findTabInTree(tree.groups)
    if (tab) {
      return JSON.stringify(tab)
    }

    logger.warn('getTabContent: Tab not found', { tabId })
    return undefined
  }, [tree])

  const callbacks = useMemo<Partial<EditorWorkbenchCallbacks>>(() => {
    return {
      onWorkbenchTabDropped: handleTabDropped,
      renderTabContent: workbenchRenderTabContent,
      renderTabTitle,
      onDetachToNewWindow: handleDetachToNewWindow,
      getTabContextMenuItems,
      onGetTabContent: getTabContent
    }
  }, [handleTabDropped, workbenchRenderTabContent, renderTabTitle, handleDetachToNewWindow, getTabContextMenuItems, getTabContent])

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
