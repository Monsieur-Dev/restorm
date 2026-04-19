import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconView,
  ListView,
  StatusbarElement,
  type ListViewItemData
} from 'electron-core-ui/renderer'
import type { Environment } from '../../../../shared/types/collections'
import { useEnvironmentContext } from '../../contexts/useEnvironmentContext'

function collectEnvironmentIds(environments: Environment[]): string[] {
  const ids: string[] = []
  for (const env of environments) {
    ids.push(env.id)
    if (env.subEnvironments) ids.push(...collectEnvironmentIds(env.subEnvironments))
  }
  return ids
}

function findEnvironmentById(environments: Environment[], id: string): Environment | null {
  for (const env of environments) {
    if (env.id === id) return env
    if (env.subEnvironments) {
      const found = findEnvironmentById(env.subEnvironments, id)
      if (found) return found
    }
  }
  return null
}

function environmentsToListViewItems(
  environments: Environment[],
  expandedIds: string[]
): ListViewItemData[] {
  return environments.map((env): ListViewItemData => {
    const isExpanded = expandedIds.includes(env.id)
    return {
      id: env.id,
      title: env.name,
      isExpandable: (env.subEnvironments?.length ?? 0) > 0,
      isExpanded,
      icon: env.icon ? <IconView icon={env.icon} size={14} /> : (isExpanded ? 'folder-opened' : 'folder'),
      children: env.subEnvironments ? environmentsToListViewItems(env.subEnvironments, expandedIds) : []
    }
  })
}

/**
 * Statusbar cell that reflects the currently-selected environment for
 * the active request and opens a click-triggered popover (via
 * `StatusbarElement`'s built-in tooltip system, `tooltipTrigger="click"`)
 * to switch envs. Must be wrapped in an `EnvironmentProvider` scoped
 * to the active request — `useEnvironmentContext` supplies the env
 * list + current selection + color.
 */
export const StatusbarEnvironmentSelector: React.FC = () => {
  const { t } = useTranslation()
  const { environments, selectedEnvId, setSelectedEnvId, envColor } = useEnvironmentContext()
  const allIds = useMemo(() => (environments ? collectEnvironmentIds(environments) : []), [environments])
  const [expandedIds, setExpandedIds] = useState<string[]>(allIds)
  useEffect(() => { setExpandedIds(allIds) }, [allIds])

  const selectedEnvironment = useMemo<Environment | null>(() => {
    if (!environments || !selectedEnvId) return null
    return findEnvironmentById(environments, selectedEnvId)
  }, [environments, selectedEnvId])

  const selectedName = selectedEnvironment?.name ?? t('requestTab.environmentSelector.noEnvironment')

  const items = useMemo(
    () => (environments && environments.length > 0 ? environmentsToListViewItems(environments, expandedIds) : []),
    [environments, expandedIds]
  )

  const handleItemClick = useCallback((payload: { item: ListViewItemData }) => {
    const id = payload.item.id
    if (!id) return
    setSelectedEnvId(id)
  }, [setSelectedEnvId])

  const handleItemToggle = useCallback((payload: { item: ListViewItemData }, expanded: boolean) => {
    const id = payload.item.id
    if (!id) return
    setExpandedIds((prev) => (
      expanded ? Array.from(new Set([...prev, id])) : prev.filter((existing) => existing !== id)
    ))
  }, [])

  if (!environments || environments.length === 0) return null

  // Fallback to the same "orange" used for the in-tab Send button
  // (`--button-background-emphasis-1`, matched by `#c75000` where the
  // CSS variable isn't themed). See `EnvironmentFolderView` line 374
  // for the other consumer that does the same.
  const effectiveColor = envColor ?? '#c75000'

  return (
    <StatusbarElement
      data-testid="statusbar-env-selector"
      className="right-aligned"
      {...(selectedEnvironment?.icon ? { icon: selectedEnvironment.icon } : {})}
      backgroundColor={effectiveColor}
      title={selectedName}
      tooltipTrigger="click"
      tooltipPlacement="above"
    >
      <div style={{ minWidth: 220, maxHeight: 320, overflow: 'auto' }}>
        <ListView
          items={items}
          rootRole="tree"
          ariaLabel={t('requestTab.environmentSelector.listAriaLabel')}
          selectedIds={selectedEnvId ? [selectedEnvId] : []}
          selectionMode="single"
          expandedIds={expandedIds}
          data-testid="statusbar-env-selector-listview"
          onItemClick={handleItemClick}
          onItemToggle={handleItemToggle}
        />
      </div>
    </StatusbarElement>
  )
}

export default StatusbarEnvironmentSelector
