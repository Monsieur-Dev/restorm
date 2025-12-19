import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  EditorTab,
  WorkbenchTree,
  GroupNode,
  TabGroupNode,
  ListViewItemData,
  ListViewDropEventPayload,
  IVerticalSashLayoutProvider,
  SashEvent
} from 'electron-core-ui/renderer'
import {
  ListView,
  isContainerNode,
  isTabGroupNode,
  logger,
  Sash
} from 'electron-core-ui/renderer'
import { Workbench } from '../Workbench'

interface DemoTabGroup { id: string, tabs: EditorTab[], activeTabId?: string }
interface DemoContainer { id: string, orientation: 'vertical' | 'horizontal', groups: DemoNode[] }
type DemoNode = DemoTabGroup | DemoContainer
interface DemoTree extends WorkbenchTree { groups: DemoNode[] }

const initialTree: DemoTree = {
  orientation: 'vertical',
  groups: []
}

interface FileTreeNode {
  name: string
  path: string
  isDirectory: boolean
  children?: FileTreeNode[]
}

interface ProjectFileEntry {
  path: string
  isDirectory: boolean
}

interface ProjectApi {
  listFiles: () => Promise<ProjectFileEntry[]>
  readFile: (filePath: string) => Promise<string>
}

function getProjectApi(): ProjectApi | null {
  const host = window as unknown as { api?: { project?: ProjectApi } }
  return host.api?.project ?? null
}

const sortFileTree = (nodes: FileTreeNode[]): FileTreeNode[] => {
  const sorted = [...nodes]

  sorted.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1
    if (!a.isDirectory && b.isDirectory) return 1
    return a.name.localeCompare(b.name)
  })

  sorted.forEach(node => {
    if (node.children && node.children.length > 0) {
      node.children = sortFileTree(node.children)
    }
  })

  return sorted
}

const buildFileTree = (entries: { path: string; isDirectory: boolean }[]): FileTreeNode[] => {
  const root: FileTreeNode = { name: '', path: '', isDirectory: true, children: [] }

  for (const entry of entries) {
    const segments = entry.path.split(/[/\\]/)
    let current = root
    let currentPath = ''

    segments.forEach((segment, index) => {
      if (!segment) return
      currentPath = currentPath ? `${currentPath}/${segment}` : segment
      const isLast = index === segments.length - 1
      const isDir = isLast ? entry.isDirectory : true

      if (!current.children) {
        current.children = []
      }

      let child = current.children.find(c => c.name === segment)
      if (!child) {
        child = { name: segment, path: currentPath, isDirectory: isDir }
        current.children.push(child)
      } else if (isDir && !child.isDirectory) {
        child.isDirectory = true
      }

      current = child
    })
  }

  const children = root.children ?? []
  return sortFileTree(children)
}

const fileTreeToListItems = (nodes: FileTreeNode[]): ListViewItemData[] => {
  return nodes.map((node) => {
    const isDir = node.isDirectory
    const children = node.children ? fileTreeToListItems(node.children) : undefined
    const icon = isDir ? undefined : 'file'

    const item: ListViewItemData = {
      id: node.path,
      title: node.name,
      icon,
      // Folders act as sticky headers in the ListView
      isStickyHeader: isDir,
      // Folders should always be considered expandable, even if currently empty
      isExpandable: isDir,
      data: isDir ? undefined : { filePath: node.path }
    }

    if (children && children.length > 0) {
      item.children = children
    }

    return item
  })
}

const findTabInTree = (tree: WorkbenchTree, tabId: string): { groupId: string; group: TabGroupNode } | null => {
  const visit = (nodes: GroupNode[]): { groupId: string; group: TabGroupNode } | null => {
    for (const node of nodes) {
      if (isTabGroupNode(node)) {
        if (node.tabs.some(tab => tab.id === tabId)) {
          return { groupId: node.id, group: node }
        }
      } else if (isContainerNode(node)) {
        const found = visit(node.groups)
        if (found) return found
      }
    }
    return null
  }
  return visit(tree.groups)
}

const updateTabContentInTree = (tree: DemoTree, tabId: string, content: string): DemoTree => {
  const next: DemoTree = JSON.parse(JSON.stringify(tree)) as DemoTree

  const visit = (nodes: GroupNode[]): void => {
    for (const node of nodes) {
      if (isTabGroupNode(node)) {
        const tab = node.tabs.find(t => t.id === tabId)
        if (tab) {
          (tab).content = content
          node.activeTabId = tabId
        }
      } else if (isContainerNode(node)) {
        visit(node.groups)
      }
    }
  }

  visit(next.groups)
  return next
}

const addTabToFirstGroup = (tree: DemoTree, tab: EditorTab): DemoTree => {
  const next: DemoTree = JSON.parse(JSON.stringify(tree)) as DemoTree

  const addToGroup = (nodes: GroupNode[]): boolean => {
    for (const node of nodes) {
      if (isTabGroupNode(node)) {
        node.tabs.push(tab)
        node.activeTabId = tab.id
        return true
      }
      if (isContainerNode(node)) {
        if (addToGroup(node.groups)) {
          return true
        }
      }
    }
    return false
  }

  if (!addToGroup(next.groups)) {
    // Fallback: create a new group at root
    const newGroup: TabGroupNode = { id: 'group-auto', tabs: [tab], activeTabId: tab.id }
    next.groups = [...next.groups, newGroup]
  }

  return next
}

const addTabToGroup = (tree: DemoTree, tab: EditorTab, targetGroupId?: string | null): DemoTree => {
  // If no target group is provided, fall back to the first existing group
  if (!targetGroupId) {
    return addTabToFirstGroup(tree, tab)
  }

  const next: DemoTree = JSON.parse(JSON.stringify(tree)) as DemoTree

  const addToTargetGroup = (nodes: GroupNode[]): boolean => {
    for (const node of nodes) {
      if (isTabGroupNode(node) && node.id === targetGroupId) {
        node.tabs.push(tab)
        node.activeTabId = tab.id
        return true
      }
      if (isContainerNode(node)) {
        if (addToTargetGroup(node.groups)) {
          return true
        }
      }
    }
    return false
  }

  if (addToTargetGroup(next.groups)) {
    return next
  }

  // If the target group no longer exists, fall back to the first group
  return addTabToFirstGroup(tree, tab)
}

const updateListAfterDrop = (
  items: ListViewItemData[],
  payload: ListViewDropEventPayload
): ListViewItemData[] => {
  const sourceId = payload.source.id
  const targetId = payload.item.id

  if (sourceId === targetId) return items

  // Remove source from tree and keep reference
  let dragged: ListViewItemData | null = null

  const removeFrom = (nodes: ListViewItemData[]): ListViewItemData[] => {
    return nodes
      .map(node => {
        if (node.id === sourceId) {
          dragged = node
          return null
        }
        if (node.children && node.children.length > 0) {
          return {
            ...node,
            children: removeFrom(node.children)
          }
        }
        return node
      })
      .filter((n): n is ListViewItemData => n !== null)
  }

  const withoutSource = removeFrom(items)

  const insertInto = (nodes: ListViewItemData[]): ListViewItemData[] => {
    return nodes.map(node => {
      if (node.id === targetId && payload.position === 'into' && dragged) {
        const children = node.children ? [...node.children, dragged] : [dragged]
        return { ...node, children }
      }

      if (node.children && node.children.length > 0) {
        return { ...node, children: insertInto(node.children) }
      }
      return node
    })
  }

  // For before/after we need to handle at the same level
  const insertAtSameLevel = (nodes: ListViewItemData[]): ListViewItemData[] => {
    const result: ListViewItemData[] = []
    for (const node of nodes) {
      if (node.id === targetId) {
        if (payload.position === 'before' && dragged) {
          result.push(dragged)
          result.push(node)
        } else if (payload.position === 'after' && dragged) {
          result.push(node)
          result.push(dragged)
        } else {
          result.push(node)
        }
      } else {
        result.push(node)
      }
    }
    return result
  }

  if (payload.position === 'into') {
    return insertInto(withoutSource)
  }

  // Handle root level before/after
  return insertAtSameLevel(withoutSource)
}

const WorkbenchTab: React.FC = () => {
  const { t } = useTranslation()
  const [tree, setTree] = useState<DemoTree>(initialTree)
  const [items, setItems] = useState<ListViewItemData[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [pendingFilePath, setPendingFilePath] = useState<string | null>(null)
  const [lastFocusedGroupId, setLastFocusedGroupId] = useState<string | null>(null)
  const isUpdatingFromListRef = useRef(false)

  const [contextMenu, setContextMenu] = useState<{
    visible: boolean
    x: number
    y: number
    target: ListViewItemData | null
  }>({
    visible: false,
    x: 0,
    y: 0,
    target: null
  })

  const initialTabContentMap: Record<string, string> = {}

  const containerRef = useRef<HTMLDivElement | null>(null)
  const [leftWidth, setLeftWidth] = useState<number>(260)
  const [containerHeight, setContainerHeight] = useState<number>(0)

  // Load file tree from project root on mount
  useEffect(() => {
    const projectApi = getProjectApi()
    if (!projectApi) {
      logger.warn('WorkbenchTab: project API is not available')
      return
    }
    void (async () => {
      try {
        const entries = await projectApi.listFiles()

        // Build ListView items from full project tree
        const treeNodes = buildFileTree(entries)
        const listItems = fileTreeToListItems(treeNodes)
        setItems(listItems)

        // Open all root-level JSON files in a first workbench group
        const rootJsonEntries = entries.filter((entry) => {
          return !entry.isDirectory && !entry.path.includes('/') && entry.path.endsWith('.json')
        })

        if (rootJsonEntries.length === 0) {
          return
        }

        const jsonContents = await Promise.all(
          rootJsonEntries.map((entry) => projectApi.readFile(entry.path))
        )

        // Build first group with all root-level JSON files, first tab active
        const jsonTabs: EditorTab[] = rootJsonEntries.map((entry, index) => {
          const path = entry.path
          const segments = path.split(/[/\\]/)
          const title = segments[segments.length - 1] ?? path
          const content = jsonContents[index]
          return {
            id: path,
            title,
            titleString: title,
            content
          }
        })

        const nextTree: DemoTree = {
          orientation: 'vertical',
          groups: []
        }

        if (jsonTabs.length > 0) {
          const firstJsonTab = jsonTabs[0]
          if (!firstJsonTab) {
            // Should not happen because jsonTabs.length > 0, but keeps types and runtime safe
            return
          }
          const jsonGroup: TabGroupNode = {
            id: 'group-json',
            tabs: jsonTabs,
            activeTabId: firstJsonTab.id
          }
          nextTree.groups = [jsonGroup]
        }

        // Open all root-level *.ts files in a second group
        const tsEntries = entries.filter((entry) => {
          return !entry.isDirectory && !entry.path.includes('/') && entry.path.endsWith('.ts')
        })

        if (tsEntries.length > 0) {
          const tsContents = await Promise.all(
            tsEntries.map((entry) => projectApi.readFile(entry.path))
          )

          const tsTabs: EditorTab[] = tsEntries.map((entry, index) => {
            const path = entry.path
            const segments = path.split(/[/\\]/)
            const title = segments[segments.length - 1] ?? path
            const content = tsContents[index]
            return {
              id: path,
              title,
              titleString: title,
              content
            }
          })

          const firstTsTab = tsTabs[0]
          if (!firstTsTab) {
            // Should not happen because tsEntries.length > 0, but keeps types and runtime safe
            return
          }
          const tsGroup: TabGroupNode = {
            id: 'group-ts',
            tabs: tsTabs,
            activeTabId: firstTsTab.id
          }
          nextTree.groups = [...nextTree.groups, tsGroup]
        }

        setTree(nextTree)
        setSelectedIds(rootJsonEntries.map((entry) => entry.path))
      } catch (error: unknown) {
        logger.error('Failed to load project files for WorkbenchTab', { error: String(error) })
      }
    })()

    return () => {
      // no cleanup needed
    }
  }, [])

  // Open file in workbench when a pending file path is set
  useEffect(() => {
    if (!pendingFilePath) {
      return
    }

    const filePath = pendingFilePath
    const projectApi = getProjectApi()
    if (!projectApi) {
      logger.warn('WorkbenchTab: project API is not available when opening file', { filePath })
      return
    }
    logger.info('WorkbenchTab: opening file from tree', { filePath })

    void projectApi.readFile(filePath)
      .then((content) => {
        isUpdatingFromListRef.current = true

        const existing = findTabInTree(tree, filePath)
        if (existing) {
          // Tab already exists: update its content, activate it,
          // and treat its group as having focus.
          setTree(prev => updateTabContentInTree(prev, filePath, content))
          setLastFocusedGroupId(existing.groupId)
        } else {
          // New tab: open it in the last focused group,
          // or in the first group if no focus is known yet.
          const node = items.find(item => item.id === filePath)
          const title =
            (node && typeof node.title === 'string' && node.title) ? node.title : filePath.split(/[/\\]/).pop() ?? filePath

          const newTab: EditorTab = {
            id: filePath,
            title,
            titleString: title,
            content
          }
          setTree(prev => addTabToGroup(prev, newTab, lastFocusedGroupId))
        }
      })
      .catch((error: unknown) => {
        logger.error('WorkbenchTab: failed to read file content', { filePath, error: String(error) })
      })
      .finally(() => {
        setPendingFilePath(null)
      })
  }, [pendingFilePath, items, tree, lastFocusedGroupId])

  const sashStartLeftRef = useRef(leftWidth)

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
      // Remember the width at drag start so that we apply the delta
      // relative to this value instead of accumulating it on each move.
      sashStartLeftRef.current = leftWidth
    },
    [leftWidth]
  )

  const handleSashChange = useCallback(
    (event: SashEvent): void => {
      if (!containerRef.current) return
      const delta = event.currentX - event.startX

      const containerWidth = containerRef.current.clientWidth
      const min = 150
      const max = Math.max(min, containerWidth - 200)
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

  // Hide context menu on any global click
  useEffect(() => {
    if (!contextMenu.visible) {
      return
    }
    const handleGlobalClick = (): void => {
      setContextMenu(prev => {
        return { ...prev, visible: false, target: null }
      })
    }
    window.addEventListener('click', handleGlobalClick)
    return () => {
      window.removeEventListener('click', handleGlobalClick)
    }
  }, [contextMenu.visible])

  const handleListSelectionChange = useCallback(
    (ids: string[], _payload: { item: ListViewItemData }): void => {
      // Defer selection sync to avoid updating WorkbenchTab during ListView's render phase
      window.setTimeout(() => {
        setSelectedIds(ids)
      }, 0)
    },
    []
  )

  const handleItemClick = useCallback(
    (payload: { item: ListViewItemData }): void => {
      const filePath: string | undefined = (payload.item.data as { filePath?: string } | undefined)?.filePath
      if (!filePath) {
        return
      }

      logger.info('WorkbenchTab: item clicked (queue open)', { filePath })
      setPendingFilePath(filePath)
    },
    []
  )

  const handleTreeChange = useCallback(
    (newTree: WorkbenchTree): void => {
      setTree(newTree as DemoTree)

      if (isUpdatingFromListRef.current) {
        isUpdatingFromListRef.current = false
        return
      }

      // On essaie d'abord de récupérer l'onglet actif dans le groupe qui a le focus
      const getActiveTabInGroup = (nodes: GroupNode[], groupId: string): string | null => {
        for (const node of nodes) {
          if (isTabGroupNode(node) && node.id === groupId) {
            return node.activeTabId ?? null
          }
          if (isContainerNode(node)) {
            const child = getActiveTabInGroup(node.groups, groupId)
            if (child) return child
          }
        }
        return null
      }

      const collectFirstActiveTabId = (nodes: GroupNode[]): string | null => {
        for (const node of nodes) {
          if (isTabGroupNode(node) && node.activeTabId) {
            return node.activeTabId
          }
          if (isContainerNode(node)) {
            const child = collectFirstActiveTabId(node.groups)
            if (child) return child
          }
        }
        return null
      }

      let activeTabId: string | null = null
      if (lastFocusedGroupId) {
        activeTabId = getActiveTabInGroup(newTree.groups, lastFocusedGroupId)
      }
      if (!activeTabId) {
        activeTabId = collectFirstActiveTabId(newTree.groups)
      }

      if (activeTabId) {
        setSelectedIds([activeTabId])
      }
    },
    [lastFocusedGroupId]
  )

  // When a Monaco editor (group) receives focus directly, keep the ListView selection in sync
  useEffect(() => {
    if (!lastFocusedGroupId) {
      return
    }

    const getActiveTabInGroup = (nodes: GroupNode[], groupId: string): string | null => {
      for (const node of nodes) {
        if (isTabGroupNode(node) && node.id === groupId) {
          return node.activeTabId ?? null
        }
        if (isContainerNode(node)) {
          const child = getActiveTabInGroup(node.groups, groupId)
          if (child) return child
        }
      }
      return null
    }

    const activeTabId = getActiveTabInGroup(tree.groups, lastFocusedGroupId)
    if (activeTabId) {
      setSelectedIds([activeTabId])
    }
  }, [lastFocusedGroupId, tree])

  const handleItemDrop = useCallback(
    (payload: ListViewDropEventPayload): void => {
      setItems(prev => updateListAfterDrop(prev, payload))
    },
    []
  )

  const handleContextMenu = useCallback(
    (payload: { item: ListViewItemData }): void => {
      logger.info('WorkbenchTab: context menu on item', { id: payload.item.id })
      setContextMenu(prev => {
        const event = window.event
        const x = event instanceof MouseEvent ? event.clientX : 0
        const y = event instanceof MouseEvent ? event.clientY : 0
        return {
          ...prev,
          visible: true,
          x,
          y,
          target: payload.item
        }
      })
    },
    []
  )

  const handleCreateChild = useCallback((): void => {
    const target = contextMenu.target
    if (!target) {
      setContextMenu(prev => {
        return { ...prev, visible: false }
      })
      return
    }

    const newId = `new-${Date.now().toString(36)}`
    const newItem: ListViewItemData = {
      id: newId,
      title: t('menuBar.new'),
      icon: 'file',
      data: {}
    }

    const addChild = (nodes: ListViewItemData[]): ListViewItemData[] =>
      nodes.map(node => {
        if (node.id === target.id) {
          const children = node.children ? [...node.children, newItem] : [newItem]
          return { ...node, children }
        }
        if (node.children && node.children.length > 0) {
          return { ...node, children: addChild(node.children) }
        }
        return node
      })

    setItems(prev => {
      return addChild(prev)
    })
    setContextMenu(prev => {
      return { ...prev, visible: false, target: null }
    })
  }, [contextMenu.target, t])

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 0
      }}
    >
      <div
        style={{
          width: leftWidth,
          minWidth: 150,
          maxWidth: '70%',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0
        }}
      >
        <ListView
          items={items}
          selectedIds={selectedIds}
          activeId={selectedIds[0] ?? null}
          rootRole="tree"
          ariaLabel="Workbench items"
          onSelectionChange={(ids, payload) => {
            handleListSelectionChange(ids, payload)
          }}
          onItemClick={(payload) => {
            handleItemClick(payload)
          }}
          onItemDrop={(payload) => {
            handleItemDrop(payload)
          }}
          onItemContextMenu={(payload, event) => {
            event.preventDefault()
            handleContextMenu(payload)
          }}
        />
      </div>

      <div
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: 'flex'
        }}
      >
    <Workbench
          tree={tree}
      initialTabContentMap={initialTabContentMap}
          onTreeChange={handleTreeChange}
          style={{ flex: 1 }}
          focusedGroupId={lastFocusedGroupId}
          onFocusedGroupChange={setLastFocusedGroupId}
        />
      </div>

      <Sash
        orientation="vertical"
        layoutProvider={layoutProvider}
        onStart={handleSashStart}
        onChange={handleSashChange}
        size={4}
      />

      {contextMenu.visible && (
        <div
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            backgroundColor: 'var(--editor-background)',
            color: 'var(--editor-foreground)',
            border: '1px solid var(--menu-border)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            zIndex: 1000,
            minWidth: 140
          }}
        >
          <div
            style={{
              padding: '4px 8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
            onClick={handleCreateChild}
          >
            <i className="codicon codicon-add" style={{ fontSize: 14 }} />
            <span>{t('menuBar.new')}</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default WorkbenchTab
