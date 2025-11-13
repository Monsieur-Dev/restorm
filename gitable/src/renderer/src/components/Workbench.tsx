import React, { useMemo, useState, useCallback, useEffect } from 'react'
import { EditorWorkbench, findGroup, isTabGroupNode, isContainerNode, logger } from 'electron-vscodelike-core-ui/renderer'
import type { EditorWorkbenchCallbacks, WorkbenchTree, EditorTab } from 'electron-vscodelike-core-ui/renderer'
import type { GitableEditorTab } from '../types/editor'
import Editor from '@monaco-editor/react'

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
}

const getLanguage = (filename: string): string => {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript'
  if (lower.endsWith('.js') || lower.endsWith('.jsx')) return 'javascript'
  if (lower.endsWith('.md')) return 'markdown'
  if (lower.endsWith('.css')) return 'css'
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.txt')) return 'plaintext'
  return 'plaintext'
}

const MonacoView: React.FC<{ name: string, text?: string }> = ({ name, text }) => (
  <div style={{ display: 'flex', flex: 1, minHeight: 0, minWidth: 0 }}>
    <Editor
      value={text ?? ''}
      defaultLanguage={getLanguage(name)}
      theme="vs-dark"
      options={{ readOnly: true, minimap: { enabled: false }, lineNumbers: 'on', automaticLayout: true }}
      loading={<div style={{ padding: 12, opacity: 0.7 }}>Loading editor…</div>}
      height="100%"
      width="100%"
    />
  </div>
)

/**
 * Wrapper component for EditorWorkbench that handles Gitable-specific tab rendering
 */
export const Workbench: React.FC<WorkbenchProps> = ({
  tree: initialTree,
  initialTabContentMap = {},
  onTreeChange,
  className,
  style
}) => {
  // In controlled mode (onTreeChange provided), use initialTree directly
  // In uncontrolled mode, use local state
  const isControlled = onTreeChange !== undefined
  const [localTree, setLocalTree] = useState<WorkbenchTree>(initialTree)
  const tree = isControlled ? initialTree : localTree
  const [tabContentMap, setTabContentMap] = useState<Record<string, string>>(initialTabContentMap)

  // In uncontrolled mode, sync local state when initialTree changes
  useEffect(() => {
    if (!isControlled) {
      logger.info('Workbench: Syncing local tree from initialTree (uncontrolled)', { 
        groupsCount: initialTree.groups.length 
      })
      setLocalTree(initialTree)
    }
  }, [initialTree, isControlled])

  // Update tabContentMap when initialTabContentMap changes
  useEffect(() => {
    setTabContentMap(initialTabContentMap)
  }, [initialTabContentMap])

  // Handle tab dropped from another window: store content and return true to allow drop
  // EditorWorkbench will handle the insertion logic
  const handleTabDropped = useCallback((tabData: { tabId: string; title: string; groupId: string; content?: string; cursorX?: number; cursorY?: number }): boolean | Promise<boolean> => {
    // Store tab content
    if (tabData.content !== undefined) {
      setTabContentMap((prev) => ({
        ...prev,
        [tabData.tabId]: tabData.content ?? ''
      }))
    }
    // Return true to allow drop (EditorWorkbench will handle the insertion)
    return true
  }, [])

  // Render tab title with icon
  const renderTabTitle = useCallback((tab: EditorTab): React.ReactNode => {
    // Extract title string for display
    const tabWithTitleString = tab as EditorTab & { titleString?: string }
    const titleString = tabWithTitleString.titleString ?? (typeof tab.title === 'string' ? tab.title : getTabTitleString(tabWithTitleString, ''))
    // Return icon and text together - icon is part of the title rendering
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <i className="codicon codicon-file" style={{ fontSize: '16px' }}></i>
        <span>{titleString}</span>
      </span>
    )
  }, [])

  // Render tab content
  const renderTabContent = useCallback((tab: GitableEditorTab): React.ReactNode => {
    const content = tab.content ?? tabContentMap[tab.id] ?? ''
    // Use titleString for filename, fallback to extracting from title
    const filename = tab.titleString ?? (typeof tab.title === 'string' ? tab.title : getTabTitleString(tab, 'untitled'))
    return <MonacoView name={filename} text={content} />
  }, [tabContentMap])

  // Get tab content
  const onGetTabContent = useCallback((tabId: string): string | undefined => {
    return tabContentMap[tabId]
  }, [tabContentMap])

  // Handle tab detach to new window
  const handleDetachToNewWindow = useCallback((tabId: string, groupId: string, cursorX?: number, cursorY?: number): void => {
    logger.info('Detaching tab to new window', { tabId, groupId, cursorX, cursorY })
    
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
    
    // Get tab content
    const content = onGetTabContent(tabId)
    
    // Get title string for serialization
    const tabWithTitleString = tab as EditorTab & { titleString?: string }
    const titleString = tabWithTitleString.titleString ?? (typeof tab.title === 'string' ? tab.title : getTabTitleString(tabWithTitleString, 'untitled'))
    
    // Open new Editor window with tab parameters and cursor position
    logger.info('Opening Editor window with detached tab', { title: titleString, hasContent: content !== undefined, cursorX, cursorY })
    const editorParams: { title: string; content?: string; x?: number; y?: number } = {
      title: titleString,
      content: content ?? ''
    }
    if (cursorX !== undefined) {
      editorParams.x = cursorX
    }
    if (cursorY !== undefined) {
      editorParams.y = cursorY
    }
    void window.gitable.openEditor(editorParams)
  }, [tree, onGetTabContent])

  // Convert renderTabContent to match EditorWorkbench's expected signature
  // Enrich the tab with content if getTabContent is provided
  const workbenchRenderTabContent = useMemo(() => {
    return (tab: unknown): React.ReactNode => {
      const baseTab = tab as GitableEditorTab
      // Enrich the tab with content
      if (!baseTab.content) {
        const content = onGetTabContent(baseTab.id)
        // Only add content property if it's defined (for exactOptionalPropertyTypes compatibility)
        const enrichedTab: GitableEditorTab = content !== undefined
          ? {
              ...baseTab,
              content
            }
          : baseTab
        return renderTabContent(enrichedTab)
      }
      return renderTabContent(baseTab)
    }
  }, [renderTabContent, onGetTabContent])

  // Merge callbacks
  const callbacks = useMemo<Partial<EditorWorkbenchCallbacks>>(() => {
    return {
      onGetTabContent,
      onWorkbenchTabDropped: handleTabDropped,
      renderTabContent: workbenchRenderTabContent,
      renderTabTitle,
      onDetachToNewWindow: handleDetachToNewWindow
    }
  }, [onGetTabContent, handleTabDropped, workbenchRenderTabContent, renderTabTitle, handleDetachToNewWindow])

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
    
    logger.info('Workbench: Tree changed from EditorWorkbench', { 
      groupsCount: newTree.groups.length,
      tabCount,
      isControlled,
      isEmpty: tabCount === 0 && newTree.groups.length === 0,
      treeString: JSON.stringify(newTree).substring(0, 200)
    })
    
    if (isControlled) {
      // Controlled mode: notify parent immediately
      // onTreeChange is guaranteed to be defined in controlled mode
      logger.info('Workbench: Notifying parent via onTreeChange (controlled mode)', { tabCount })
      onTreeChange(newTree)
    } else {
      // Uncontrolled mode: update local state
      logger.info('Workbench: Updating local tree (uncontrolled mode)', { tabCount })
      setLocalTree(newTree)
    }
  }, [onTreeChange, isControlled])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', flex: 1, ...style }} className={className}>
      <EditorWorkbench tree={tree} onChange={handleTreeChange} {...callbacks} />
    </div>
  )
}

export default Workbench

