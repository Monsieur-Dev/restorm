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
  type Tab,
  IconSelect,
  KeyValueTable
} from 'electron-core-ui/renderer'
import type { KeyValueTableHandle } from 'electron-core-ui/renderer'
import type { EnvironmentFolder, Environment, KeyValue, Icon } from '../types/collections'
import { useEnvironmentValues } from '../contexts/useEnvironmentValues'
import { BaseFolderView } from './BaseFolderView'

/** Generate a unique ID for a new environment */
function generateEnvironmentId(): string {
  return `env-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

const MIN_LEFT_WIDTH = 160
const RIGHT_MIN_WIDTH = 240

export interface EnvironmentFolderViewProps {
  /** The environment folder to display */
  folder: EnvironmentFolder
  /** Called when folder data changes (environments, etc.) */
  onFolderChange?: (folder: EnvironmentFolder) => void
}

/** Convert environments to ListView items */
function environmentsToListViewItems(
  environments: Environment[],
  expandedIds: string[],
  contextMenuItems: ContextMenuItem[],
  renderLeftActions?: (env: Environment) => React.ReactNode
): ListViewItemData[] {
  return environments.map((env) => ({
    id: env.id,
    title: env.name,
    isExpandable: (env.subEnvironments?.length ?? 0) > 0,
    isExpanded: expandedIds.includes(env.id),
    contextMenuItems,
    leftActions: renderLeftActions?.(env),
    children: env.subEnvironments
      ? environmentsToListViewItems(env.subEnvironments, expandedIds, contextMenuItems, renderLeftActions)
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

/** Add an environment to a list at the root level */
function addEnvironmentToList(environments: Environment[], newEnv: Environment): Environment[] {
  return [...environments, newEnv]
}

/** Add a sub-environment to a parent environment */
function addSubEnvironment(environments: Environment[], parentId: string, newEnv: Environment): Environment[] {
  return environments.map(env => {
    if (env.id === parentId) {
      return {
        ...env,
        subEnvironments: [...(env.subEnvironments ?? []), newEnv]
      }
    }
    if (env.subEnvironments) {
      return {
        ...env,
        subEnvironments: addSubEnvironment(env.subEnvironments, parentId, newEnv)
      }
    }
    return env
  })
}

/** Delete an environment by ID */
function deleteEnvironmentById(environments: Environment[], id: string): Environment[] {
  return environments
    .filter(env => env.id !== id)
    .map(env => {
      if (env.subEnvironments) {
        return {
          ...env,
          subEnvironments: deleteEnvironmentById(env.subEnvironments, id)
        }
      }
      return env
    })
}

/** Rename an environment by ID */
function renameEnvironmentById(environments: Environment[], id: string, newName: string): Environment[] {
  return environments.map(env => {
    if (env.id === id) {
      return { ...env, name: newName }
    }
    if (env.subEnvironments) {
      return {
        ...env,
        subEnvironments: renameEnvironmentById(env.subEnvironments, id, newName)
      }
    }
    return env
  })
}

/**
 * Internal component for the environment configuration panel.
 * Separated to keep the main component cleaner.
 */
interface EnvironmentConfigPanelProps {
  folder: EnvironmentFolder
  onFolderChange?: ((folder: EnvironmentFolder) => void) | undefined
}

const EnvironmentConfigPanel: React.FC<EnvironmentConfigPanelProps> = ({ folder, onFolderChange }) => {
  const { t } = useTranslation()
  const { setEnvironmentValues } = useEnvironmentValues()

  // Local state for environments (allows modifications without waiting for parent)
  const [localEnvironments, setLocalEnvironments] = useState<Environment[]>(
    () => folder.environments
  )

  // Sync local state when folder prop changes
  useEffect(() => {
    setLocalEnvironments(folder.environments)
  }, [folder.environments])

  // Helper to update environments and notify parent
  const updateEnvironments = useCallback((newEnvironments: Environment[]) => {
    setLocalEnvironments(newEnvironments)
    // Update reactive object directly for search indexing
    folder.environments = newEnvironments
    if (onFolderChange) {
      onFolderChange({
        ...folder,
        environments: newEnvironments
      })
    }
  }, [folder, onFolderChange])

  // Initialize with all environments expanded
  const allEnvIds = useMemo(
    () => collectEnvironmentIds(localEnvironments),
    [localEnvironments]
  )
  const [expandedIds, setExpandedIds] = useState<string[]>(allEnvIds)

  // Track selected environment (default to first one)
  const [selectedEnvId, setSelectedEnvId] = useState<string | null>(
    () => localEnvironments[0]?.id ?? null
  )

  // Track item being renamed (used by context menu to trigger rename mode)
  const [_renamingEnvId, setRenamingEnvId] = useState<string | null>(null)
  void _renamingEnvId // Will be used when ListView supports external rename trigger

  // Get the selected environment
  const selectedEnvironment = useMemo(
    () =>
      selectedEnvId
        ? findEnvironmentById(localEnvironments, selectedEnvId)
        : null,
    [localEnvironments, selectedEnvId]
  )

  // Handler for adding a new environment
  const handleAddEnvironment = useCallback(() => {
    const newEnv: Environment = {
      id: generateEnvironmentId(),
      name: t('environment.newName'),
      variables: []
    }
    const newEnvironments = addEnvironmentToList(localEnvironments, newEnv)
    updateEnvironments(newEnvironments)
    // Select the new environment
    setSelectedEnvId(newEnv.id)
  }, [t, localEnvironments, updateEnvironments])

  // Handler for adding a sub-environment
  const handleAddSubEnvironment = useCallback((parentId: string) => {
    const newEnv: Environment = {
      id: generateEnvironmentId(),
      name: t('environment.newName'),
      variables: []
    }
    const newEnvironments = addSubEnvironment(localEnvironments, parentId, newEnv)
    updateEnvironments(newEnvironments)
    // Ensure parent is expanded and select the new environment
    setExpandedIds(prev => Array.from(new Set([...prev, parentId])))
    setSelectedEnvId(newEnv.id)
  }, [t, localEnvironments, updateEnvironments])

  // Handler for deleting an environment
  const handleDeleteEnvironment = useCallback((envId: string) => {
    const newEnvironments = deleteEnvironmentById(localEnvironments, envId)
    updateEnvironments(newEnvironments)
    if (selectedEnvId === envId) {
      setSelectedEnvId(newEnvironments[0]?.id ?? null)
    }
  }, [localEnvironments, selectedEnvId, updateEnvironments])

  // Handler for renaming an environment
  const handleRenameEnvironment = useCallback((envId: string, newName: string) => {
    const newEnvironments = renameEnvironmentById(localEnvironments, envId, newName)
    updateEnvironments(newEnvironments)
  }, [localEnvironments, updateEnvironments])

  // Handler for changing an environment's icon
  const handleIconChange = useCallback((envId: string, icon: Icon | null) => {
    const updateIcon = (envs: Environment[]): Environment[] =>
      envs.map(env => {
        if (env.id === envId) {
          if (icon) {
            return { ...env, icon }
          }
          // Remove icon property if null
          const { icon: _removed, ...rest } = env
          return rest as Environment
        }
        if (env.subEnvironments) {
          return { ...env, subEnvironments: updateIcon(env.subEnvironments) }
        }
        return env
      })
    updateEnvironments(updateIcon(localEnvironments))
  }, [localEnvironments, updateEnvironments])

  // Render the icon selector for each environment item
  const renderEnvLeftActions = useCallback((env: Environment): React.ReactNode => (
    <IconSelect
      value={env.icon ?? null}
      onChange={(icon) => {
        handleIconChange(env.id, icon)
      }}
      style={{ width: 24, height: 24 }}
    />
  ), [handleIconChange])

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
    () => environmentsToListViewItems(localEnvironments, expandedIds, envContextMenuItems, renderEnvLeftActions),
    [localEnvironments, expandedIds, envContextMenuItems, renderEnvLeftActions]
  )

  const containerRef = useRef<HTMLDivElement | null>(null)
  const [leftWidth, setLeftWidth] = useState<number>(220)
  const [containerHeight, setContainerHeight] = useState<number>(0)
  const sashStartLeftRef = useRef<number>(leftWidth)
  const variablesParamsRef = useRef<KeyValueTableHandle | null>(null)

  const handleEnvironmentVariablesResolved = useCallback(
    (context: unknown): void => {
      if (selectedEnvId) {
        setEnvironmentValues(selectedEnvId, context as Record<string, string>)
      }
    },
    [selectedEnvId, setEnvironmentValues]
  )

  // Handler for persisting variable changes to the environment
  const handleEnvironmentVariablesChange = useCallback(
    (newVariables: KeyValue[]): void => {
      if (!selectedEnvId) return
      // Update the selected environment's variables
      const updateVariables = (envs: Environment[]): Environment[] =>
        envs.map(env => {
          if (env.id === selectedEnvId) {
            return { ...env, variables: newVariables }
          }
          if (env.subEnvironments) {
            return { ...env, subEnvironments: updateVariables(env.subEnvironments) }
          }
          return env
        })
      updateEnvironments(updateVariables(localEnvironments))
    },
    [selectedEnvId, localEnvironments, updateEnvironments]
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

  return (
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
          borderRight: '1px solid var(--sideBar-border)',
          backgroundColor: 'var(--sideBar-background)'
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
          backgroundColor: 'var(--editor-background)'
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
                <KeyValueTable
                  key={selectedEnvId}
                  ref={variablesParamsRef}
                  // At folder level, variables are defined sequentially:
                  // no base variables, each row can only see previous rows.
                  variables={[]}
                  initialRows={selectedEnvironment?.variables ?? []}
                  visibilityMode="accumulated"
                  onResolvedContextChange={handleEnvironmentVariablesResolved}
                  onRowsChange={handleEnvironmentVariablesChange}
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
                  color: 'var(--descriptionForeground)',
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
}

export const EnvironmentFolderView: React.FC<EnvironmentFolderViewProps> = ({ folder, onFolderChange }) => {
  const { t } = useTranslation()

  // Configuration tab with environment management
  const configurationTab: Tab = {
    id: 'configuration',
    label: t('folderView.tabs.configuration'),
    useScrollableElement: false,
    content: <EnvironmentConfigPanel folder={folder} onFolderChange={onFolderChange} />
  }

  return (
    <BaseFolderView
      folder={folder}
      additionalTabs={[configurationTab]}
      defaultActiveTabId="configuration"
    />
  )
}

export default EnvironmentFolderView
