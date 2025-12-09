import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { EditorWorkbench, findGroup, isTabGroupNode, isContainerNode, logger } from 'electron-core-ui/renderer'
import type { EditorWorkbenchCallbacks, WorkbenchTree, EditorTab } from 'electron-core-ui/renderer'
import type { restormEditorTab } from '../types/editor'
import { HTTPRequestTabView } from './HTTPRequestTabView'
import { FolderView } from './FolderView'
import { HttpMethodBadge } from './HttpMethodBadge'

// Helper function to extract title string from EditorTab
// This is a local implementation to avoid TypeScript export issues
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
  /**
   * ID of the group that was focused last in the workbench.
   * Used to open new files in the correct group.
   */
  focusedGroupId?: string | null
  /**
   * Callback fired whenever the focused group changes.
   */
  onFocusedGroupChange?: (groupId: string | null) => void
}

// Local alias to bypass strict prop typing issues coming from external package d.ts
const EditorWorkbenchAny = EditorWorkbench as unknown as React.ComponentType<Record<string, unknown>>

/**
 * Wrapper component for EditorWorkbench that handles restorm-specific tab rendering
 */
export const Workbench: React.FC<WorkbenchProps> = ({
  tree: initialTree,
  onTreeChange,
  className,
  style,
  focusedGroupId,
  onFocusedGroupChange
}) => {
  // In controlled mode (onTreeChange provided), use initialTree directly
  // In uncontrolled mode, use local state
  const isControlled = onTreeChange !== undefined
  const [localTree, setLocalTree] = useState<WorkbenchTree>(initialTree)
  const tree = isControlled ? initialTree : localTree
  const lastTabCountRef = useRef<number>(0)

  // In uncontrolled mode, sync local state when initialTree changes
  useEffect(() => {
    if (!isControlled) {
      setLocalTree(initialTree)
    }
  }, [initialTree, isControlled])

  // Handle tab dropped from another window: accept the drop and let EditorWorkbench manage tree updates
  const handleTabDropped = useCallback((_tabData: { tabId: string; title: string; groupId: string; content?: string; cursorX?: number; cursorY?: number }): boolean | Promise<boolean> => {
    return true
  }, [])

  // Render tab title with icon and HTTP method badge (if applicable)
  const renderTabTitle = useCallback((tab: EditorTab): React.ReactNode => {
    // Extract title string for display
    const tabWithTitleString = tab as EditorTab & { titleString?: string; id?: string }
    const rawTitleString = tabWithTitleString.titleString ?? (typeof tab.title === 'string' ? tab.title : getTabTitleString(tabWithTitleString, ''))

    // Special case: folder view tab uses a folder icon
    if (tabWithTitleString.id === 'tab-folder-view-pet') {
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <i className="codicon codicon-folder-opened" aria-hidden="true" />
          <span>{rawTitleString}</span>
        </span>
      )
    }

    const [maybeMethod, ...rest] = rawTitleString.split(' ')
    const upperMethod = maybeMethod?.toUpperCase()
    const httpMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
    const isHttpMethod = upperMethod !== undefined && httpMethods.includes(upperMethod)
    const pathText = isHttpMethod ? rest.join(' ') : rawTitleString

    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        {isHttpMethod && <HttpMethodBadge method={upperMethod} />}
        <span>{pathText}</span>
      </span>
    )
  }, [])

  // Render tab content (design-only for now, without Monaco editor)
  const renderTabContent = useCallback((tab: restormEditorTab): React.ReactNode => {
    const titleString = getTabTitleString(tab as EditorTab & { titleString?: string }, '')

    if (tab.id === 'tab-folder-view-pet') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              flex: 1,
              minHeight: 0,
              minWidth: 0,
              backgroundColor: 'var(--ecui-editor-background)'
            }}
          >
            <FolderView />
          </div>
        </div>
      )
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minHeight: 0,
            padding: '8px 16px',
            borderBottom: '1px solid var(--ecui-panel-border)',
            backgroundColor: 'var(--ecui-editor-background)'
          }}
        >
          <HTTPRequestTabView requestTitle={titleString} />
        </div>
      </div>
    )
  }, [])

  // Handle tab detach to new window
  const handleDetachToNewWindow = useCallback((tabId: string, groupId: string, cursorX?: number, cursorY?: number): void => {
    // Find the group and tab in the tree
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
    
    // Get title string for serialization
    const tabWithTitleString = tab as EditorTab & { titleString?: string }
    const titleString = tabWithTitleString.titleString ?? (typeof tab.title === 'string' ? tab.title : getTabTitleString(tabWithTitleString, 'untitled'))
    
    // Open new Editor window with tab parameters and cursor position
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
  }, [tree])

  // Convert renderTabContent to match EditorWorkbench's expected signature
  const workbenchRenderTabContent = useMemo(() => {
    return (tab: unknown): React.ReactNode => {
      const baseTab = tab as restormEditorTab
      return renderTabContent(baseTab)
    }
  }, [renderTabContent])

  // Merge callbacks
  const callbacks = useMemo<Partial<EditorWorkbenchCallbacks>>(() => {
    return {
      onWorkbenchTabDropped: handleTabDropped,
      renderTabContent: workbenchRenderTabContent,
      renderTabTitle,
      onDetachToNewWindow: handleDetachToNewWindow
    }
  }, [handleTabDropped, workbenchRenderTabContent, renderTabTitle, handleDetachToNewWindow])

  // Handle tree change from EditorWorkbench
  const handleTreeChange = useCallback((newTree: WorkbenchTree) => {
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
    
    if (isControlled) {
      // Controlled mode: notify parent immediately
      // onTreeChange is guaranteed to be defined in controlled mode
      onTreeChange(newTree)
    } else {
      // Uncontrolled mode: update local state
      setLocalTree(newTree)
    }
  }, [onTreeChange, isControlled])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', flex: 1, ...style }} className={className}>
      <EditorWorkbenchAny
        tree={tree}
        onChange={handleTreeChange}
        focusedGroupId={focusedGroupId ?? undefined}
        onFocusedGroupChange={onFocusedGroupChange}
        {...callbacks}
      />
    </div>
  )
}

export default Workbench

