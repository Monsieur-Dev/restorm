import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ListView,
  type ListViewItemData,
  type ListViewItemEventPayload,
  type ContextMenuItem,
  VerticalSashContainer,
  SplitView,
  Pane,
  Button,
  type Tab,
  IconSelect,
  ColorPicker,
  Tooltip,
  type KeyValueTableHandle
} from 'electron-core-ui/renderer'
import { RestormKeyValueTable } from '../RestormKeyValueTable'
import { useHandlebarsHelpers } from '../../hooks/useHandlebarsHelpers'
import type { EnvironmentFolder, Environment, KeyValue, Icon } from '../../../../shared/types/collections'

// Helper to update reactive proxy properties (intentional mutation for reactive objects)
// Uses direct property assignment to trigger proxy setter
function updateReactiveProperty<T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): void {
  // Direct assignment triggers the proxy's set trap
  (obj as Record<K, T[K]>)[key] = value
}
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
  const handlebarsHelpers = useHandlebarsHelpers()

  // Local state for environments (allows modifications without waiting for parent)
  const [localEnvironments, setLocalEnvironments] = useState<Environment[]>(
    () => folder.environments
  )

  // Sync local state when folder prop changes
  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      setLocalEnvironments(folder.environments)
    })
    return (): void => { cancelAnimationFrame(rafId) }
  }, [folder.environments])

  // Helper to update environments and notify parent
  const updateEnvironments = useCallback((newEnvironments: Environment[]) => {
    setLocalEnvironments(newEnvironments)
    // Update reactive object directly for search indexing
    updateReactiveProperty(folder, 'environments', newEnvironments)
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

  // Track which environment's color picker is open
  const [colorPickerEnvId, setColorPickerEnvId] = useState<string | null>(null)
  const colorButtonRef = useRef<HTMLButtonElement | null>(null)
  const tooltipClassName = 'restorm-env-color-picker-tooltip'

  // Close color picker on outside mousedown
  useEffect(() => {
    if (!colorPickerEnvId) return

    const handleMouseDown = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (!target) return

      // Ignore clicks on the color button itself
      if (colorButtonRef.current?.contains(target)) return

      // Ignore clicks inside the tooltip
      const tooltipEl = document.querySelector(`.${tooltipClassName}`)
      if (tooltipEl?.contains(target)) return

      setColorPickerEnvId(null)
    }

    document.addEventListener('mousedown', handleMouseDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
    }
  }, [colorPickerEnvId])

  // Track item being renamed (used by context menu to trigger rename mode)
  const [_renamingEnvId, setRenamingEnvId] = useState<string | null>(null)
  void _renamingEnvId // Will be used when ListView supports external rename trigger

  // Get the selected environment from local state (for display)
  const selectedEnvironment = useMemo(
    () =>
      selectedEnvId
        ? findEnvironmentById(localEnvironments, selectedEnvId)
        : null,
    [localEnvironments, selectedEnvId]
  )

  // Get the reactive environment object directly from folder.environments
  // This is used for mutations to avoid triggering React re-renders
  const reactiveSelectedEnvironment = useMemo(
    () =>
      selectedEnvId
        ? findEnvironmentById(folder.environments, selectedEnvId)
        : null,
    [folder.environments, selectedEnvId]
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
          return rest
        }
        if (env.subEnvironments) {
          return { ...env, subEnvironments: updateIcon(env.subEnvironments) }
        }
        return env
      })
    updateEnvironments(updateIcon(localEnvironments))
  }, [localEnvironments, updateEnvironments])

  // Handler for changing an environment's color
  const handleEnvColorChange = useCallback((envId: string, color: string) => {
    const updateColor = (envs: Environment[]): Environment[] =>
      envs.map(env => {
        if (env.id === envId) {
          updateReactiveProperty(env, 'color', color)
          return env
        }
        if (env.subEnvironments) {
          return { ...env, subEnvironments: updateColor(env.subEnvironments) }
        }
        return env
      })
    updateEnvironments(updateColor(localEnvironments))
  }, [localEnvironments, updateEnvironments])

  // Find the current color for an environment by ID
  const findEnvColor = useCallback((envId: string): string | undefined => {
    const findColor = (envs: Environment[]): string | undefined => {
      for (const env of envs) {
        if (env.id === envId) return env.color
        if (env.subEnvironments) {
          const found = findColor(env.subEnvironments)
          if (found) return found
        }
      }
      return undefined
    }
    return findColor(localEnvironments)
  }, [localEnvironments])

  // Render the icon selector and color button for each environment item
  const renderEnvLeftActions = useCallback((env: Environment): React.ReactNode => (
    <>
      <IconSelect
        value={env.icon ?? null}
        onChange={(icon) => {
          handleIconChange(env.id, icon)
        }}
        style={{ width: 24, height: 24 }}
        data-testid={`environment-icon-select-${env.id}`}
      />
      <button
        ref={(el) => {
          // Store ref when this is the active color picker target
          if (colorPickerEnvId === env.id || !colorButtonRef.current) {
            colorButtonRef.current = el
          }
        }}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          colorButtonRef.current = e.currentTarget as HTMLButtonElement
          setColorPickerEnvId(prev => prev === env.id ? null : env.id)
        }}
        style={{
          width: 14,
          height: 14,
          minWidth: 14,
          padding: 0,
          border: '1px solid var(--panel-border)',
          borderRadius: 3,
          backgroundColor: env.color ?? 'var(--button-background-emphasis-1, #c75000)',
          cursor: 'pointer',
          flexShrink: 0
        }}
        data-testid={`environment-color-button-${env.id}`}
      />
    </>
  ), [handleIconChange, colorPickerEnvId])

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

  const [leftWidth] = useState<number>(220)
  const variablesParamsRef = useRef<KeyValueTableHandle | null>(null)

  // Handler for persisting variable changes to the environment
  // Updates the reactive object directly without triggering React re-renders
  const handleEnvironmentVariablesChange = useCallback(
    (newVariables: KeyValue[]): void => {
      if (!reactiveSelectedEnvironment) return
      // Directly mutate the reactive environment object from folder.environments
      // This will trigger the eventBus event via reactive.ts without re-rendering
      updateReactiveProperty(reactiveSelectedEnvironment, 'variables', newVariables)
    },
    [reactiveSelectedEnvironment]
  )

  return (
    <VerticalSashContainer
      data-testid="environment-folder-sash-container"
      Left={
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            minWidth: 0,
            minHeight: 0,
            height: '100%',
            borderRight: '1px solid var(--sideBar-border)',
            backgroundColor: 'var(--sideBar-background)'
          }}
        >
          <SplitView
            orientation="vertical"
            style={{ width: '100%', height: '100%' }}
            data-testid="environment-folder-sidebar-splitview"
          >
            <Pane
              title={t('folderView.environments')}
              collapsible={false}
              minSize={MIN_LEFT_WIDTH}
              data-testid="environment-folder-sidebar-pane"
              headerActions={
                <>
                  <Button
                    secondary
                    small
                    icon="add"
                    options={{ ariaLabel: t('environment.add'), title: t('environment.add') }}
                    onClick={handleAddEnvironment}
                    data-testid="environment-folder-add-environment-button"
                  />
                  <Button
                    secondary
                    small
                    icon="collapse-all"
                    options={{ ariaLabel: t('sidebar.collapseAll'), title: t('sidebar.collapseAll') }}
                    onClick={() => {
                      setExpandedIds([])
                    }}
                    data-testid="environment-folder-collapse-all-button"
                  />
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
                data-testid="environment-folder-environment-list"
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
                  setSelectedEnvId(payload.item.id)
                }}
              />
              <Tooltip
                targetRef={colorButtonRef as unknown as React.RefObject<HTMLElement | null>}
                show={colorPickerEnvId !== null}
                placement="below"
                className={tooltipClassName}
                data-testid="environment-color-picker-tooltip"
                repositionKey={colorPickerEnvId}
                content={
                  <div onMouseDown={(e) => { e.stopPropagation() }}>
                    <ColorPicker
                      value={colorPickerEnvId ? (findEnvColor(colorPickerEnvId) ?? '#c75000') : '#c75000'}
                      onChange={(color) => {
                        if (colorPickerEnvId) {
                          handleEnvColorChange(colorPickerEnvId, color)
                        }
                      }}
                      disableAlpha
                      data-testid="environment-color-picker"
                    />
                  </div>
                }
              />
            </Pane>
          </SplitView>
        </div>
      }
      Right={
        <div
          style={{
            minHeight: 0,
            display: 'flex',
            boxSizing: 'border-box',
            backgroundColor: 'var(--editor-background)'
          }}
        >
          <SplitView
            orientation="vertical"
            style={{ width: '100%', height: '100%' }}
            data-testid="environment-folder-content-splitview"
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
                data-testid="environment-folder-variables-pane"
                headerActions={
                  <Button
                    secondary
                    small
                    icon="add"
                    options={{ ariaLabel: t('folderView.addVariable'), title: t('folderView.addVariable') }}
                    onClick={() => {
                      variablesParamsRef.current?.addRow()
                    }}
                    data-testid="environment-folder-add-variable-button"
                  />
                }
              >
                <div
                  style={{
                    padding: '8px 8px 4px 8px',
                    boxSizing: 'border-box'
                  }}
                >
                  <RestormKeyValueTable
                    key={selectedEnvId}
                    ref={variablesParamsRef}
                    variables={[]}
                    helpers={handlebarsHelpers}
                    initialRows={reactiveSelectedEnvironment?.variables ?? []}
                    onRowsChange={handleEnvironmentVariablesChange}
                    data-testid="environment-folder-variables-table"
                  />
                </div>
              </Pane>
            ) : (
              <Pane
                title={t('folderView.variables')}
                collapsible={false}
                minSize={80}
                data-testid="environment-folder-variables-pane"
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
      }
      initialWidth={leftWidth}
      minLeftWidth={MIN_LEFT_WIDTH}
      minRightWidth={RIGHT_MIN_WIDTH}
      sashConfig={{ size: 4 }}
      className="environment-folder-view"
    />
  )
}

interface ApiDocWithSource {
  sourceUrl?: string
}

const EnvironmentFolderViewInner: React.FC<EnvironmentFolderViewProps> = ({ folder, onFolderChange }) => {
  const { t } = useTranslation()

  // Configuration tab with environment management
  const configurationTab: Tab = {
    id: 'configuration',
    label: t('folderView.tabs.configuration'),
    useScrollableElement: false,
    content: <EnvironmentConfigPanel folder={folder} onFolderChange={onFolderChange} />
  }

  // API-level documentation (root.hbs) compiled on the fly whenever the
  // folder holds an `apiDocumentation` object. The root is the only place
  // where a synthesised overview is always useful, so the Docs tab is
  // pinned visible even if `folder.documentation` is empty.
  const [compiledRootDocs, setCompiledRootDocs] = useState<string>(folder.documentation)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)
  const apiDocumentation = (folder as unknown as { apiDocumentation?: unknown }).apiDocumentation as (ApiDocWithSource & Record<string, unknown>) | undefined
  const sourceUrl = apiDocumentation?.sourceUrl

  useEffect(() => {
    let cancelled = false
    if (!apiDocumentation) {
      setCompiledRootDocs(folder.documentation)
      return
    }
    const compile = (window as unknown as {
      restorm?: { docs?: { compileRoot?: (apiDoc: unknown) => Promise<{ markdown: string }> } }
    }).restorm?.docs?.compileRoot
    if (!compile) return
    compile(apiDocumentation).then(res => {
      if (cancelled) return
      setCompiledRootDocs(res.markdown)
    }).catch(() => { /* fall back to empty docs */ })
    return () => { cancelled = true }
  }, [apiDocumentation, folder.documentation, refreshTick])

  const handleRefreshDocs = useCallback(async () => {
    if (!sourceUrl || isRefreshing) return
    setIsRefreshing(true)
    try {
      const importer = (window as unknown as {
        restorm?: { import?: { import?: (input: string) => Promise<{
          success: boolean
          items?: { apiDocumentation?: unknown }[]
          error?: string
        }> } }
      }).restorm?.import?.import
      if (!importer) return
      const result = await importer(sourceUrl)
      if (!result.success) return
      const freshApiDoc = result.items?.[0]?.apiDocumentation
      if (!freshApiDoc) return
      // Mutate through the reactive proxy so indexing and UI react.
      updateReactiveProperty(folder as unknown as Record<'apiDocumentation', unknown>, 'apiDocumentation', freshApiDoc)
      setRefreshTick(t => t + 1)
    } finally {
      setIsRefreshing(false)
    }
  }, [sourceUrl, isRefreshing, folder])

  const docsHeader = sourceUrl ? (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderBottom: '1px solid var(--editorWidget-border, rgba(0,0,0,0.1))' }}
      data-testid={`env-folder-view-docs-header-${folder.id}`}
    >
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.75, fontSize: 12 }} title={sourceUrl}>
        {t('folderView.docs.source')} <code>{sourceUrl}</code>
      </span>
      <Button
        secondary
        icon="refresh"
        onClick={() => { void handleRefreshDocs() }}
        disabled={isRefreshing}
        data-testid={`env-folder-view-refresh-docs-${folder.id}`}
      >
        {isRefreshing ? t('folderView.docs.refreshing') : t('folderView.docs.refresh')}
      </Button>
    </div>
  ) : undefined

  return (
    <BaseFolderView
      folder={folder}
      additionalTabs={[configurationTab]}
      defaultActiveTabId="configuration"
      documentationOverride={compiledRootDocs}
      alwaysShowDocs
      docsHeader={docsHeader}
    />
  )
}

export const EnvironmentFolderView = React.memo(EnvironmentFolderViewInner)

export default EnvironmentFolderView
