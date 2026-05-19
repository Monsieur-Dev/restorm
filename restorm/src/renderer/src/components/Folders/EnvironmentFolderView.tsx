import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import EnvironmentFolderHome from './EnvironmentFolderHome'
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
import { makeReactiveEnvironment, emitEnvironmentCreated, emitEnvironmentDeleted, emitEnvironmentUpdated } from '../../types/reactive'

// Helper to update reactive proxy properties (intentional mutation for reactive objects)
// Uses direct property assignment to trigger proxy setter
function updateReactiveProperty<T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): void {
  // Direct assignment triggers the proxy's set trap
  (obj as Record<K, T[K]>)[key] = value
}
import { BaseFolderView } from './BaseFolderView'
import type { ApiDocumentation, OperationDocumentation } from '../../../../shared/types/apiDocumentation'
import { DocumentationHost } from '../documentation/DocumentationHost'
import { mergeEnumDefinitionsIntoModels } from '../documentation/mergeEnumDefinitions'
import { useRequestCreation } from '../../contexts/useRequestCreation'
import { consumePendingEnvFolderSubTab, subscribeEnvFolderSubTabIntent } from '../../services/envFolderTabIntent'

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
  /** Open a request by id — same handler the sidebar wires for clicks.
   *  Threaded down to `EnvironmentFolderHome` so the Favorite Requests
   *  list rows behave like sidebar entries. */
  onRequestClick?: (requestId: string) => void
  /** Middle-click variant of `onRequestClick`. Opens the request tab
   *  without focusing it — the "open in background" gesture. */
  onRequestAuxClick?: (requestId: string) => void
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

  // Helper to update environments and notify parent. Re-wraps every env
  // in `makeReactiveEnvironment` before persisting — the helpers above
  // (`addSubEnvironment`, `deleteEnvironmentById`, the icon/color
  // updaters) spread `{...env}` during tree rewrites, which strips the
  // proxy from ancestors. Re-wrapping here is idempotent (already-reactive
  // envs are returned as-is) and guarantees variable edits on any env
  // still fire ENVIRONMENT_UPDATED → marks the window dirty.
  const updateEnvironments = useCallback((newEnvironments: Environment[]) => {
    const reactiveNext = newEnvironments.map((env) => makeReactiveEnvironment(env, folder.id))
    setLocalEnvironments(reactiveNext)
    // Update reactive object directly for search indexing
    updateReactiveProperty(folder, 'environments', reactiveNext)
    if (onFolderChange) {
      onFolderChange({
        ...folder,
        environments: reactiveNext
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

  // Env id currently in inline-rename mode. Driven by the context
  // menu's "Rename" action AND by the new-environment / new-sub-env
  // handlers below, which drop the freshly-created env straight into
  // rename mode so the user can type the real name without a second
  // click. `null` when nothing is being renamed; the ListView clears
  // it via `onEditingEnd`.
  const [editingEnvId, setEditingEnvId] = useState<string | null>(null)

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

  // Handler for adding a new environment. Emits ENVIRONMENT_CREATED
  // explicitly — `folder.environments` is not in `FOLDER_INDEXABLE_KEYS`
  // (it would flood upsertSaveUnit during Swagger import), so the
  // folder-proxy set trap no longer fires when we assign the new list.
  // The explicit emit travels through the same `handleUpsert` wiring
  // in App.tsx and marks the window dirty.
  const handleAddEnvironment = useCallback(() => {
    const newEnv = makeReactiveEnvironment(
      {
        id: generateEnvironmentId(),
        name: t('environment.newName'),
        variables: []
      },
      folder.id
    )
    const newEnvironments = addEnvironmentToList(localEnvironments, newEnv)
    updateEnvironments(newEnvironments)
    emitEnvironmentCreated(newEnv, folder.id)
    // Select the new environment AND drop it into inline-rename mode so
    // the user can type the real name without an extra right-click /
    // F2 — matches the sidebar tree's "new folder" UX.
    setSelectedEnvId(newEnv.id)
    setEditingEnvId(newEnv.id)
  }, [t, folder.id, localEnvironments, updateEnvironments])

  // Handler for adding a sub-environment. See `handleAddEnvironment`
  // for why we emit ENVIRONMENT_CREATED explicitly rather than relying
  // on the folder-proxy set trap.
  const handleAddSubEnvironment = useCallback((parentId: string) => {
    const newEnv = makeReactiveEnvironment(
      {
        id: generateEnvironmentId(),
        name: t('environment.newName'),
        variables: []
      },
      folder.id,
      parentId
    )
    const newEnvironments = addSubEnvironment(localEnvironments, parentId, newEnv)
    updateEnvironments(newEnvironments)
    emitEnvironmentCreated(newEnv, folder.id, parentId)
    // Ensure parent is expanded, select the new environment, and drop
    // it into inline-rename mode (same UX as the top-level add).
    setExpandedIds(prev => Array.from(new Set([...prev, parentId])))
    setSelectedEnvId(newEnv.id)
    setEditingEnvId(newEnv.id)
  }, [t, folder.id, localEnvironments, updateEnvironments])

  // Handler for deleting an environment. Emits ENVIRONMENT_DELETED so
  // the save-unit registry records a pending delete — without the
  // explicit emit, nothing on the folder-proxy would fire (environments
  // is intentionally non-indexable for perf, see reactive.ts).
  const handleDeleteEnvironment = useCallback((envId: string) => {
    const newEnvironments = deleteEnvironmentById(localEnvironments, envId)
    updateEnvironments(newEnvironments)
    emitEnvironmentDeleted(envId, folder.id)
    if (selectedEnvId === envId) {
      setSelectedEnvId(newEnvironments[0]?.id ?? null)
    }
  }, [folder.id, localEnvironments, selectedEnvId, updateEnvironments])

  // Handler for renaming an environment
  const handleRenameEnvironment = useCallback((envId: string, newName: string) => {
    const newEnvironments = renameEnvironmentById(localEnvironments, envId, newName)
    updateEnvironments(newEnvironments)
  }, [localEnvironments, updateEnvironments])

  // Handler for changing an environment's icon. Emits
  // ENVIRONMENT_UPDATED explicitly for the same reason as the other
  // env CRUD handlers: `folder.environments` is not indexable, so the
  // folder-proxy set trap can't carry the dirty signal. The env proxy
  // won't emit either — `icon` isn't in ENVIRONMENT_INDEXABLE_KEYS
  // because we build a new env POJO here rather than mutating, so
  // none of the proxy traps fire.
  const handleIconChange = useCallback((envId: string, icon: Icon | null) => {
    const updateIcon = (envs: Environment[]): Environment[] =>
      envs.map(env => {
        if (env.id === envId) {
          const next = icon
            ? { ...env, icon }
            // Remove icon property if null
            : (() => {
              const { icon: _removed, ...rest } = env
              void _removed
              return rest
            })()
          emitEnvironmentUpdated(next, folder.id)
          return next
        }
        if (env.subEnvironments) {
          return { ...env, subEnvironments: updateIcon(env.subEnvironments) }
        }
        return env
      })
    updateEnvironments(updateIcon(localEnvironments))
  }, [folder.id, localEnvironments, updateEnvironments])

  // Handler for changing an environment's color. Builds a NEW env
  // object with the updated colour (mirroring `handleIconChange`)
  // and emits ENVIRONMENT_UPDATED explicitly — see the matching
  // comment on `handleIconChange` for why the reactive proxies alone
  // can't catch this.
  const handleEnvColorChange = useCallback((envId: string, color: string) => {
    const updateColor = (envs: Environment[]): Environment[] =>
      envs.map(env => {
        if (env.id === envId) {
          const next = { ...env, color }
          emitEnvironmentUpdated(next, folder.id)
          return next
        }
        if (env.subEnvironments) {
          return { ...env, subEnvironments: updateColor(env.subEnvironments) }
        }
        return env
      })
    updateEnvironments(updateColor(localEnvironments))
  }, [folder.id, localEnvironments, updateEnvironments])

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
          setEditingEnvId(selectedEnvId)
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

  const [leftWidth] = useState<number>(320)
  const variablesParamsRef = useRef<KeyValueTableHandle | null>(null)

  // Context variables state is managed inside ContextVariablesSection
  // (a separate memoized component) to avoid re-rendering the KV table
  // inputs when the resolved context updates during typing.

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
                editingItemId={editingEnvId}
                onEditingStart={(id) => { setEditingEnvId(id) }}
                onEditingEnd={() => { setEditingEnvId(null) }}
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
                    {...(folder.enumDefinitions && folder.enumDefinitions.length > 0
                      ? { enumDefinitions: folder.enumDefinitions }
                      : {})}
                    persistenceId={`env-folder-vars:${folder.id}`}
                    data-testid="environment-folder-variables-table"
                  />
                </div>
                <ContextVariablesSection envId={selectedEnvId} />
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

/**
 * Isolated component for the context variables table. Manages its own
 * IPC subscription so that live context updates don't re-render the
 * parent panel (which holds the KV table inputs — re-rendering during
 * typing would steal focus).
 */
const ContextVariablesSection = React.memo<{ envId: string | null }>(({ envId }) => {
  const { t } = useTranslation()
  const [contextVars, setContextVars] = useState<Record<string, string>>({})
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  useEffect(() => {
    const ctx = window.restorm?.context
    if (!envId || !ctx) return
    let cancelled = false
    void ctx.getEnvironmentContext(envId).then((result: Record<string, string>) => {
      if (!cancelled) setContextVars(result)
    })
    const unsubscribe = ctx.onEnvironmentContextChanged((result: { environmentId: string; context: Record<string, string> }) => {
      if (!cancelled && result.environmentId === envId) setContextVars(result.context)
    })
    return () => { cancelled = true; unsubscribe() }
  }, [envId])

  const handleCopy = useCallback((key: string) => {
    void navigator.clipboard.writeText(`{{${key}}}`)
    setCopiedKey(key)
    setTimeout(() => { setCopiedKey(null) }, 1500)
  }, [])

  const keys = Object.keys(contextVars)
  if (keys.length === 0) return null

  return (
    <div data-testid="environment-folder-context-pane" style={{ marginTop: 16, padding: '0 4px' }}>
      <h3 style={{
        margin: '0 0 8px', fontSize: 12, fontWeight: 600, textTransform: 'uppercase',
        opacity: 0.4, letterSpacing: 1, display: 'flex', alignItems: 'center', gap: 6
      }}>
        <span className="codicon codicon-symbol-variable" style={{ fontSize: 14 }} />
        {t('folderView.contextVariables.title')}
      </h3>
      <p style={{ margin: '0 0 10px', fontSize: 12, lineHeight: 1.5, color: 'var(--descriptionForeground)' }}>
        {t('folderView.contextVariables.description')}
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }} data-testid="context-variables-table">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--panel-border)' }}>
            <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600, opacity: 0.6, width: 28 }} />
            <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600, opacity: 0.6 }}>{t('folderView.contextVariables.name')}</th>
            <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600, opacity: 0.6 }}>{t('folderView.contextVariables.value')}</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(contextVars).map(([key, value]) => (
            <tr
              key={key}
              style={{ borderBottom: '1px solid var(--panel-border)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--list-hoverBackground)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              <td style={{ padding: '3px 4px', textAlign: 'center' }}>
                <button
                  type="button"
                  onClick={() => { handleCopy(key) }}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: 2,
                    opacity: copiedKey === key ? 1 : 0.5,
                    color: copiedKey === key ? 'var(--notificationsInfoIcon-foreground)' : 'inherit',
                    fontSize: 14, lineHeight: 1
                  }}
                  title={copiedKey === key ? t('folderView.contextVariables.copied') : `{{${key}}}`}
                  data-testid={`context-var-copy-${key}`}
                >
                  <span className={`codicon codicon-${copiedKey === key ? 'check' : 'copy'}`} />
                </button>
              </td>
              <td style={{ padding: '3px 8px', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{`{{${key}}}`}</td>
              <td style={{ padding: '3px 8px', fontFamily: 'monospace', opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 0 }}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
})

ContextVariablesSection.displayName = 'ContextVariablesSection'

const EnvironmentFolderViewInner: React.FC<EnvironmentFolderViewProps> = ({ folder, onFolderChange, onRequestClick, onRequestAuxClick }) => {
  const { t } = useTranslation()
  const switchTabFnRef = useRef<((tabId: string) => void) | null>(null)
  const handleSwitchTab = useCallback((tabId: string) => { switchTabFnRef.current?.(tabId) }, [])
  // Drain any pending sub-tab intent staged by `ApiCard`'s quick
  // links on the EmptyBench when the env-folder view first mounts;
  // also subscribe so the same gesture works when the view is
  // already on screen.
  const handleSwitchTabReady = useCallback((fn: (tabId: string) => void) => {
    switchTabFnRef.current = fn
    const pending = consumePendingEnvFolderSubTab(folder.id)
    if (pending !== undefined) fn(pending)
  }, [folder.id])
  useEffect(() => {
    const unsubscribe = subscribeEnvFolderSubTabIntent((folderId, tabId) => {
      if (folderId === folder.id) switchTabFnRef.current?.(tabId)
    })
    return unsubscribe
  }, [folder.id])
  const requestCreation = useRequestCreation()

  // Home tab — overview page for the environment folder
  const homeTab: Tab = {
    id: 'home',
    label: <span className="codicon codicon-home" />,
    content: <EnvironmentFolderHome folder={folder} onSwitchTab={handleSwitchTab} {...(onRequestClick ? { onRequestClick } : {})} {...(onRequestAuxClick ? { onRequestAuxClick } : {})} />
  }

  // Environments tab — hosts the env-list editor + per-env variables.
  // Kept singular to match the sidebar's "Environments" terminology.
  const environmentsTab: Tab = {
    id: 'environments',
    label: t('folderView.tabs.environments'),
    useScrollableElement: false,
    content: <EnvironmentConfigPanel folder={folder} onFolderChange={onFolderChange} />
  }

  const rawApiDocumentation = (folder as unknown as { apiDocumentation?: unknown }).apiDocumentation as ApiDocumentation | undefined
  const apiDocumentation = useMemo(() => (
    rawApiDocumentation !== undefined
      ? mergeEnumDefinitionsIntoModels(rawApiDocumentation, folder.enumDefinitions)
      : undefined
  ), [rawApiDocumentation, folder.enumDefinitions])

  // Structured documentation viewer for the whole API spec. No
  // filters → host renders the API title + every operation +
  // every model + every enum. Memoized so the heavy ELK / React Flow
  // subtree doesn't re-create on every parent render.
  const docsContent = useMemo(() => {
    if (!apiDocumentation) return undefined
    return (
      <DocumentationHost
        apiDocumentation={apiDocumentation}
        {...(apiDocumentation.api.title.length > 0 ? { scopeTitle: apiDocumentation.api.title } : {})}
        {...(apiDocumentation.api.description !== undefined && apiDocumentation.api.description.length > 0
          ? { scopeDescription: apiDocumentation.api.description }
          : {})}
        {...(folder.tagColors ? { tagColors: folder.tagColors } : {})}
        showApiInfo
        {...(requestCreation
          ? {
            onAddRequest: (operation: OperationDocumentation): void => {
              requestCreation.createFromOperation(operation, { envFolderId: folder.id })
            }
          }
          : {})}
        testId="env-folder-documentation-host"
      />
    )
  }, [apiDocumentation, requestCreation, folder.id, folder.tagColors])

  return (
    <BaseFolderView
      folder={folder}
      additionalTabs={[homeTab, environmentsTab]}
      {...(docsContent !== undefined ? { docsContent } : {})}
      defaultActiveTabId="home"
      onSwitchTabReady={handleSwitchTabReady}
    />
  )
}

export const EnvironmentFolderView = React.memo(EnvironmentFolderViewInner)

export default EnvironmentFolderView
