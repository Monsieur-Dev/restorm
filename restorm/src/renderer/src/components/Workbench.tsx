import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import * as CoreUIRenderer from 'electron-core-ui/renderer'
import { EditorWorkbench, findGroup, isTabGroupNode, isContainerNode, logger } from 'electron-core-ui/renderer'
import type { EditorWorkbenchCallbacks, WorkbenchTree, EditorTab } from 'electron-core-ui/renderer'
import type { RestormEditorTab, BreadcrumbItem } from '../types/editor'
import { isFolderTab, isHTTPRequestTab } from '../types/editor'
import { HTTPRequestTabView } from './HTTPRequestTabView'
import { FolderView } from './FolderView'
import { HttpMethodBadge } from './HttpMethodBadge'

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
  /** Fallback component displayed when no tabs are open */
  emptyFallback?: React.ReactNode
}

const { Breadcrumb } = CoreUIRenderer as unknown as {
  Breadcrumb: React.ComponentType<{
    items: BreadcrumbItem[]
    onItemClick?: (item: BreadcrumbItem, index: number, event: React.MouseEvent<HTMLButtonElement>) => void
    onLastItemChange?: (item: BreadcrumbItem, newValue: string, index: number) => void
  }>
}

const EditorWorkbenchAny = EditorWorkbench as unknown as React.ComponentType<Record<string, unknown>>

/** Wrapper component for EditorWorkbench that handles restorm-specific tab rendering */
export const Workbench: React.FC<WorkbenchProps> = ({
  tree: initialTree,
  onTreeChange,
  className,
  style,
  focusedGroupId,
  onFocusedGroupChange,
  onTabActivate,
  onBreadcrumbClick,
  onItemRename,
  emptyFallback
}) => {
  const isControlled = onTreeChange !== undefined
  const [localTree, setLocalTree] = useState<WorkbenchTree>(initialTree)
  const tree = isControlled ? initialTree : localTree
  const lastTabCountRef = useRef<number>(0)
  const lastActiveTabIdRef = useRef<string | null>(null)

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

    // Legacy tab: parse title for method
    const [maybeMethod, ...rest] = titleString.split(' ')
    const upperMethod = maybeMethod?.toUpperCase()
    const httpMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
    const isHttpMethod = upperMethod !== undefined && httpMethods.includes(upperMethod)
    const pathText = isHttpMethod ? rest.join(' ') : titleString

    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        {isHttpMethod && <HttpMethodBadge method={upperMethod} />}
        <span>{pathText}</span>
      </span>
    )
  }, [])

  // Handle breadcrumb item click
  const handleBreadcrumbClick = useCallback(
    (item: BreadcrumbItem, index: number, breadcrumbs: BreadcrumbItem[]) => {
      const isLast = index === breadcrumbs.length - 1
      onBreadcrumbClick?.(item, index, isLast)
    },
    [onBreadcrumbClick]
  )

  // Handle breadcrumb last item rename
  const handleBreadcrumbRename = useCallback(
    (item: BreadcrumbItem, newValue: string) => {
      onItemRename?.(item, newValue)
    },
    [onItemRename]
  )

  // Render tab content based on tab type
  const renderTabContent = useCallback((tab: RestormEditorTab): React.ReactNode => {
    const breadcrumbs = tab.breadcrumbs ?? [
      { id: 'root', label: 'Swagger Petstore' }
    ]

    // Folder tab
    if (isFolderTab(tab)) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              flex: 1,
              minHeight: 0,
              minWidth: 0,
              backgroundColor: 'var(--vscode-editor-background)'
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 }}>
              <Breadcrumb
                items={breadcrumbs}
                onItemClick={(item, index) => {
                  handleBreadcrumbClick(item, index, breadcrumbs)
                }}
                onLastItemChange={(item, newValue) => {
                  handleBreadcrumbRename(item, newValue)
                }}
              />
              <FolderView folder={tab.folder} />
            </div>
          </div>
        </div>
      )
    }

    // HTTP request tab
    if (isHTTPRequestTab(tab)) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              minHeight: 0,
              padding: '8px 16px',
              borderBottom: '1px solid var(--vscode-panel-border)',
              backgroundColor: 'var(--vscode-editor-background)'
            }}
          >
            <Breadcrumb
              items={breadcrumbs}
              onItemClick={(item, index) => {
                handleBreadcrumbClick(item, index, breadcrumbs)
              }}
              onLastItemChange={(item, newValue) => {
                handleBreadcrumbRename(item, newValue)
              }}
            />
            <HTTPRequestTabView request={tab.request} />
          </div>
        </div>
      )
    }

    // Legacy/empty tab
    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
            color: 'var(--vscode-descriptionForeground)'
          }}
        >
          No content
        </div>
      </div>
    )
  }, [handleBreadcrumbClick, handleBreadcrumbRename])

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
        tree={tree}
        onChange={handleTreeChange}
        focusedGroupId={focusedGroupId ?? undefined}
        onFocusedGroupChange={onFocusedGroupChange}
        emptyFallback={emptyFallback}
        {...callbacks}
      />
    </div>
  )
}

export default Workbench
