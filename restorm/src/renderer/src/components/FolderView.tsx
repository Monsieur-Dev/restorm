import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ListView,
  type ListViewItemData,
  type ListViewItemEventPayload,
  type ContextMenuItem,
  Sash,
  type IVerticalSashLayoutProvider,
  type SashEvent,
  SplitView,
  Pane,
  Button,
  Tabs,
  type Tab,
  MarkdownEditor,
  MarkdownViewer
} from 'electron-core-ui/renderer'
import { ParamsTabView } from './ParamsTabView'
import type { ParamsTabViewHandle } from './ParamsTabView'
import type { Folder, Environment } from '../types/collections'
import { useEnvironmentValues } from '../contexts/EnvironmentValuesContext'

/** Generate a unique ID for a new environment */
function generateEnvironmentId(): string {
  return `env-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

const MIN_LEFT_WIDTH = 160
const RIGHT_MIN_WIDTH = 240

export interface FolderViewProps {
  /** The folder to display */
  folder: Folder
}

/** Convert environments to ListView items */
function environmentsToListViewItems(
  environments: Environment[],
  expandedIds: string[],
  contextMenuItems: ContextMenuItem[]
): ListViewItemData[] {
  return environments.map((env) => ({
    id: env.id,
    title: env.name,
    isExpandable: (env.subEnvironments?.length ?? 0) > 0,
    isExpanded: expandedIds.includes(env.id),
    icon: expandedIds.includes(env.id) ? 'folder-opened' : 'folder',
    contextMenuItems,
    children: env.subEnvironments
      ? environmentsToListViewItems(env.subEnvironments, expandedIds, contextMenuItems)
      : []
  }))
}

/** Collect all environment IDs recursively */
function collectEnvironmentIds(environments: Environment[]): string[] {
  const ids: string[] = []
  for (const env of environments) {
    ids.push(env.id)
    if (env.subEnvironments) {
      ids.push(...collectEnvironmentIds(env.subEnvironments))
    }
  }
  return ids
}

/** Find an environment by ID recursively */
function findEnvironmentById(environments: Environment[], id: string): Environment | null {
  for (const env of environments) {
    if (env.id === id) {
      return env
    }
    if (env.subEnvironments) {
      const found = findEnvironmentById(env.subEnvironments, id)
      if (found) return found
    }
  }
  return null
}

export const FolderView: React.FC<FolderViewProps> = ({ folder }) => {
  const { t } = useTranslation()
  const { setEnvironmentValues } = useEnvironmentValues()
  const [activeTabId, setActiveTabId] = useState<string>('configuration')

  // Initialize with all environments expanded
  const allEnvIds = useMemo(
    () => collectEnvironmentIds(folder.configuration.environments),
    [folder.configuration.environments]
  )
  const [expandedIds, setExpandedIds] = useState<string[]>(allEnvIds)

  // Track selected environment (default to first one)
  const [selectedEnvId, setSelectedEnvId] = useState<string | null>(
    () => folder.configuration.environments[0]?.id ?? null
  )

  // Track item being renamed (used by context menu to trigger rename mode)
  const [_renamingEnvId, setRenamingEnvId] = useState<string | null>(null)
  void _renamingEnvId // Will be used when ListView supports external rename trigger

  // Get the selected environment
  const selectedEnvironment = useMemo(
    () =>
      selectedEnvId
        ? findEnvironmentById(folder.configuration.environments, selectedEnvId)
        : null,
    [folder.configuration.environments, selectedEnvId]
  )

  // Handler for adding a new environment
  const handleAddEnvironment = useCallback(() => {
    const newEnv: Environment = {
      id: generateEnvironmentId(),
      name: t('environment.newName'),
      variables: []
    }
    // TODO: This should update the actual folder data through a prop callback
    // For now, we just log
    // eslint-disable-next-line no-console
    console.log('Add environment:', newEnv)
  }, [t])

  // Handler for adding a sub-environment
  const handleAddSubEnvironment = useCallback((parentId: string) => {
    const newEnv: Environment = {
      id: generateEnvironmentId(),
      name: t('environment.newName'),
      variables: []
    }
    // TODO: This should update the actual folder data through a prop callback
    // For now, we just log
    // eslint-disable-next-line no-console
    console.log('Add sub-environment to:', parentId, newEnv)
  }, [t])

  // Handler for deleting an environment
  const handleDeleteEnvironment = useCallback((envId: string) => {
    // TODO: This should update the actual folder data through a prop callback
    // For now, we just log
    // eslint-disable-next-line no-console
    console.log('Delete environment:', envId)
    if (selectedEnvId === envId) {
      setSelectedEnvId(null)
    }
  }, [selectedEnvId])

  // Handler for renaming an environment
  const handleRenameEnvironment = useCallback((envId: string, newName: string) => {
    // TODO: This should update the actual folder data through a prop callback
    // For now, we just log
    // eslint-disable-next-line no-console
    console.log('Rename environment:', envId, 'to', newName)
  }, [])

  // Context menu items for environments
  const envContextMenuItems = useMemo<ContextMenuItem[]>(() => [
    {
      id: 'rename',
      label: t('environment.rename'),
      shortcut: 'F2',
      onClick: () => {
        if (selectedEnvId) {
          setRenamingEnvId(selectedEnvId)
        }
      }
    },
    {
      id: 'addSubEnvironment',
      label: t('environment.addSub'),
      shortcut: 'Ctrl++',
      onClick: () => {
        if (selectedEnvId) {
          handleAddSubEnvironment(selectedEnvId)
        }
      }
    },
    {
      id: 'delete',
      label: t('environment.delete'),
      shortcut: 'Delete',
      onClick: () => {
        if (selectedEnvId) {
          handleDeleteEnvironment(selectedEnvId)
        }
      }
    }
  ], [t, selectedEnvId, handleAddSubEnvironment, handleDeleteEnvironment])

  // Convert environments to ListView items
  const sidebarItems: ListViewItemData[] = useMemo(
    () => environmentsToListViewItems(folder.configuration.environments, expandedIds, envContextMenuItems),
    [folder.configuration.environments, expandedIds, envContextMenuItems]
  )

  const containerRef = useRef<HTMLDivElement | null>(null)
  const [leftWidth, setLeftWidth] = useState<number>(220)
  const [containerHeight, setContainerHeight] = useState<number>(0)
  const sashStartLeftRef = useRef<number>(leftWidth)
  const variablesParamsRef = useRef<ParamsTabViewHandle | null>(null)

  const handleEnvironmentVariablesResolved = useCallback(
    (context: unknown): void => {
      if (selectedEnvId) {
        setEnvironmentValues(selectedEnvId, context as Record<string, string>)
      }
    },
    [selectedEnvId, setEnvironmentValues]
  )

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

  const configurationContent = (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        position: 'relative',
        flex: 1,
        minHeight: 0,
        minWidth: 0
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
            title={t('folderView.environments')}
            collapsible={false}
            minSize={MIN_LEFT_WIDTH}
            headerActions={
              <>
                <Button
                  secondary
                  small
                  options={{ ariaLabel: t('environment.add'), title: t('environment.add') }}
                  onClick={handleAddEnvironment}
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
              items={sidebarItems}
              rootRole="tree"
              ariaLabel={t('folderView.environmentsAriaLabel')}
              selectedIds={selectedEnvId ? [selectedEnvId] : []}
              isRenameable
              expandOnChevronOnly
              onItemClick={(payload) => {
                const id = payload.item.id
                if (id) {
                  setSelectedEnvId(id)
                }
              }}
              onItemToggle={(payload, expanded) => {
                const id = payload.item.id
                if (!id) return
                setExpandedIds((prev) =>
                  expanded
                    ? Array.from(new Set([...prev, id]))
                    : prev.filter((existingId) => existingId !== id)
                )
              }}
              onItemRename={(payload: ListViewItemEventPayload, newValue: string) => {
                handleRenameEnvironment(payload.item.id, newValue)
              }}
              onItemContextMenu={(payload) => {
                // Select the item when right-clicking
                setSelectedEnvId(payload.item.id)
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
          display: 'flex',
          boxSizing: 'border-box',
          backgroundColor: 'var(--vscode-editor-background)'
        }}
      >
        <SplitView
          orientation="vertical"
          style={{ width: '100%', height: '100%' }}
        >
          {selectedEnvId ? (
            <Pane
              title={
                selectedEnvironment
                  ? `${t('folderView.variables')} - ${selectedEnvironment.name}`
                  : t('folderView.variables')
              }
              collapsible={false}
              minSize={80}
              headerActions={
                <Button
                  secondary
                  small
                  options={{ ariaLabel: t('folderView.addVariable'), title: t('folderView.addVariable') }}
                  onClick={() => {
                    variablesParamsRef.current?.addRow()
                  }}
                >
                  <i className="codicon codicon-add" />
                </Button>
              }
            >
              <div
                style={{
                  padding: '8px 8px 4px 8px',
                  boxSizing: 'border-box'
                }}
              >
                <ParamsTabView
                  key={selectedEnvId}
                  ref={variablesParamsRef}
                  // At folder level, variables are defined sequentially:
                  // no base variables, each row can only see previous rows.
                  variables={[]}
                  initialRows={selectedEnvironment?.variables ?? []}
                  visibilityMode="accumulated"
                  onResolvedContextChange={handleEnvironmentVariablesResolved}
                />
              </div>
            </Pane>
          ) : (
            <Pane
              title={t('folderView.variables')}
              collapsible={false}
              minSize={80}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  color: 'var(--vscode-descriptionForeground)',
                  fontStyle: 'italic',
                  padding: 16
                }}
              >
                {t('folderView.selectEnvironment')}
              </div>
            </Pane>
          )}
        </SplitView>
      </div>

      <Sash
        orientation="vertical"
        layoutProvider={layoutProvider}
        onStart={handleSashStart}
        onChange={handleSashChange}
        size={4}
      />
    </div>
  )

  const tabs: Tab[] = [
    {
      id: 'configuration',
      label: t('folderView.tabs.configuration'),
      useScrollableElement: false,
      content: configurationContent
    },
    {
      id: 'docs',
      label: t('folderView.tabs.docs'),
      useScrollableElement: false,
      content: (
        <MarkdownViewer
          value={folder.documentation || `# ${folder.name}\n\nNo documentation available.`}
        />
      )
    },
    {
      id: 'notes',
      label: t('folderView.tabs.notes'),
      useScrollableElement: false,
      content: <MarkdownEditor initialValue={folder.notes ?? ''} />
    }
  ]

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        minWidth: 0
      }}
    >
      <Tabs
        tabs={tabs}
        activeTabId={activeTabId}
        onTabChange={setActiveTabId}
      />
    </div>
  )
}

export default FolderView
