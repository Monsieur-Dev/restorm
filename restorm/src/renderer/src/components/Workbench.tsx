import React, { useMemo, useState, useCallback, useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import { EditorWorkbench, findGroup, isTabGroupNode, isContainerNode, logger } from 'electron-core-ui/renderer'
import type { EditorWorkbenchCallbacks, WorkbenchTree, EditorTab, EditorWorkbenchHandle, RebuildTabCallback } from 'electron-core-ui/renderer'
import type { RestormEditorTab, BreadcrumbItem } from '../types/editor'
import { isFolderTab, isHTTPRequestTab } from '../types/editor'
import { HTTPRequestTabView, EnvironmentDropdown } from './HTTPRequestTabView'
import { EnvironmentProvider } from '../contexts/EnvironmentContext'
import { FolderView } from './FolderView'
import { HttpMethodBadge } from './HttpMethodBadge'
import { useTranslation } from 'react-i18next'
import { WorkbenchTab } from './WorkbenchTab'

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

export interface WorkbenchProps {
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
}

/** Imperative handle for Workbench component */
export interface WorkbenchHandle {
  saveState: () => Promise<boolean>
  loadState: () => Promise<WorkbenchTree | null>
  clearState: () => Promise<boolean>
}

const EditorWorkbenchAny = EditorWorkbench as unknown as React.ForwardRefExoticComponent<Record<string, unknown> & React.RefAttributes<EditorWorkbenchHandle>>

/** Wrapper component for EditorWorkbench that handles restorm-specific tab rendering */
export const Workbench = forwardRef<WorkbenchHandle, WorkbenchProps>(({
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
  emptyFallback,
  onSizesChange,
  workbenchId,
  autosave,
  onRebuildTab,
  onStateRestored
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
    const titleString = getTabTitleString(restormTab, '')

    // Folder tab: show folder icon
    if (isFolderTab(restormTab)) {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <i className="codicon codicon-folder-opened" aria-hidden="true" />
          <span>{restormTab.folder.name}</span>
        </span>
      )
    }

    // HTTP request tab: show method badge
    if (isHTTPRequestTab(restormTab)) {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <HttpMethodBadge method={restormTab.request.method} />
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
      return (
        <WorkbenchTab
          breadcrumbs={breadcrumbs}
          onBreadcrumbClick={onBreadcrumbClick}
          onBreadcrumbRename={onItemRename}
          tags={tab.folder.tags}
          onTagsChange={(nextTags) => {
            onTagsChange?.(tab.folder.id, nextTags)
          }}
          label={t('workbench.tagsLabel')}
        >
          <FolderView
            folder={tab.folder}
            onFolderChange={(updatedFolder) => {
              if (onFolderChange) {
                onFolderChange(tab.folder.id, updatedFolder)
              }
            }}
          />
        </WorkbenchTab>
      )
    }

    // HTTP request tab
    if (isHTTPRequestTab(tab)) {
      return (
        <EnvironmentProvider environments={tab.environments}>
          <WorkbenchTab
            breadcrumbs={breadcrumbs}
            onBreadcrumbClick={onBreadcrumbClick}
            onBreadcrumbRename={onItemRename}
            tags={tab.request.tags}
            onTagsChange={(nextTags) => {
              onTagsChange?.(tab.request.id, nextTags)
            }}
            label={t('workbench.tagsLabel')}
            headerRight={<EnvironmentDropdown />}
          >
            <div style={{ flex: 1, minHeight: 0, minWidth: 0, padding: '8px 16px' }}>
              <HTTPRequestTabView request={tab.request} />
            </div>
          </WorkbenchTab>
        </EnvironmentProvider>
      )
    }

    // Legacy/empty tab fallback (should not happen with typed tabs)
    return null
  }, [onBreadcrumbClick, onItemRename, onTagsChange, onFolderChange, t])

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

      const titleString = getTabTitleString(tab as RestormEditorTab, 'untitled')

      const editorParams: { title: string; content?: string; x?: number; y?: number } = {
        title: titleString,
        content: ''
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
      onDetachToNewWindow: handleDetachToNewWindow
    }
  }, [handleTabDropped, workbenchRenderTabContent, renderTabTitle, handleDetachToNewWindow])

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

Workbench.displayName = 'Workbench'

export default Workbench
