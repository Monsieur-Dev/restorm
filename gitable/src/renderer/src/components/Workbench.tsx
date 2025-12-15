import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { EditorWorkbench, findGroup, isTabGroupNode, isContainerNode, logger } from 'electron-core-ui/renderer'
import type { EditorWorkbenchCallbacks, WorkbenchTree, EditorTab } from 'electron-core-ui/renderer'
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

interface MonacoEditorInstance {
  focus: () => void
}

const MonacoView: React.FC<{
  name: string
  text?: string
  tabId: string
  registerEditor?: (tabId: string, editor: MonacoEditorInstance) => void
}> = ({ name, text, tabId, registerEditor }) => (
  <div style={{ display: 'flex', flex: 1, minHeight: 0, minWidth: 0 }}>
    <Editor
      value={text ?? ''}
      defaultLanguage={getLanguage(name)}
      theme="vs-dark"
      // Ensure one Monaco model per tab so that scroll and view state are fully independent
      path={tabId}
      options={{ readOnly: true, minimap: { enabled: false }, lineNumbers: 'on', automaticLayout: true }}
      loading={<div style={{ padding: 12, opacity: 0.7 }}>Loading editor…</div>}
      height="100%"
      width="100%"
      onMount={(editor) => {
        if (!registerEditor) return
        registerEditor(tabId, editor as MonacoEditorInstance)
      }}
    />
  </div>
)

// Local alias to bypass strict prop typing issues coming from external package d.ts
const EditorWorkbenchAny = EditorWorkbench as unknown as React.ComponentType<Record<string, unknown>>

/**
 * Wrapper component for EditorWorkbench that handles Gitable-specific tab rendering
 */
export const Workbench: React.FC<WorkbenchProps> = ({
  tree: initialTree,
  initialTabContentMap = {},
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
  const [tabContentMap, setTabContentMap] = useState<Record<string, string>>(initialTabContentMap)
  const editorInstancesRef = useRef<Record<string, MonacoEditorInstance>>({})
  const lastTabCountRef = useRef<number>(0)
  const lastRequestedFocusTabIdRef = useRef<string | null>(null)

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

  const registerEditor = useCallback((tabId: string, editor: MonacoEditorInstance) => {
    editorInstancesRef.current[tabId] = editor
    logger.info('Workbench: Monaco editor mounted for tab', {
      tabId,
      hasPendingFocusRequest: lastRequestedFocusTabIdRef.current === tabId
    })
    // Ne pas forcer le focus ici : on laisse handleTreeChange s'en occuper
  }, [])

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
    return <MonacoView name={filename} text={content} tabId={tab.id} registerEditor={registerEditor} />
  }, [tabContentMap, registerEditor])

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

  const handleTabActivated = useCallback((tabId: string): void => {
    lastRequestedFocusTabIdRef.current = tabId
    const hasEditor = !!editorInstancesRef.current[tabId]
    logger.info('Workbench: onTabSelected received from core', {
      tabId,
      hasEditorInstance: hasEditor,
      knownEditors: Object.keys(editorInstancesRef.current)
    })

    // Defer focus to the end of the event loop to ensure the tab is visible/layouted
    window.setTimeout(() => {
      const editor = editorInstancesRef.current[tabId]
      if (editor) {
        logger.info('Workbench: Focusing Monaco editor from deferred onTabSelected', { tabId })
        editor.focus()
      } else {
        logger.warn('Workbench: Deferred focus but no editor instance found', {
          tabId,
          knownEditors: Object.keys(editorInstancesRef.current)
        })
      }
    }, 0)
  }, [])

  // Merge callbacks
  const callbacks = useMemo<Partial<EditorWorkbenchCallbacks>>(() => {
    return {
      onGetTabContent,
      onWorkbenchTabDropped: handleTabDropped,
      renderTabContent: workbenchRenderTabContent,
      renderTabTitle,
      onDetachToNewWindow: handleDetachToNewWindow,
      onActivateTab: handleTabActivated
    }
  }, [onGetTabContent, handleTabDropped, workbenchRenderTabContent, renderTabTitle, handleDetachToNewWindow, handleTabActivated])

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
