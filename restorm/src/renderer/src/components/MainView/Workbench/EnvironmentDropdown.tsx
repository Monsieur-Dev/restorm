import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ListViewDropdown,
  type ListViewItemData,
  IconSelect
} from 'electron-core-ui/renderer'
import type { Environment } from '../../../types/collections'
import { useEnvironmentContext } from '../../../contexts/useEnvironmentContext'

/** Convert environments to ListView items */
function environmentsToListViewItems(
  environments: Environment[],
  expandedIds: string[]
): ListViewItemData[] {
  return environments.map((env) => ({
    id: env.id,
    title: env.name,
    isExpandable: (env.subEnvironments?.length ?? 0) > 0,
    isExpanded: expandedIds.includes(env.id),
    icon: !env.icon ? (expandedIds.includes(env.id) ? 'folder-opened' : 'folder') : undefined,
    leftActions: env.icon ? <IconSelect value={env.icon} readonly /> : undefined,
    children: env.subEnvironments ? environmentsToListViewItems(env.subEnvironments, expandedIds) : []
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

export const EnvironmentDropdown: React.FC = () => {
  const { t } = useTranslation()
  const { environments, selectedEnvId, setSelectedEnvId } = useEnvironmentContext()
  const [expandedIds, setExpandedIds] = useState<string[]>(() =>
    environments && environments.length > 0 ? collectEnvironmentIds(environments) : []
  )

  // Reset state when environments change
  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      if (environments && environments.length > 0) {
        setExpandedIds(collectEnvironmentIds(environments))
        // Keep current selected environment if still present (including sub-environments), otherwise default to first
        if (!selectedEnvId || !findEnvironmentById(environments, selectedEnvId)) {
          setSelectedEnvId(environments[0]?.id ?? null)
        }
      } else {
        setExpandedIds([])
        setSelectedEnvId(null)
      }
    })
    return (): void => { cancelAnimationFrame(rafId) }
  }, [environments, selectedEnvId, setSelectedEnvId])

  const items = useMemo(
    () => (environments && environments.length > 0 ? environmentsToListViewItems(environments, expandedIds) : []),
    [environments, expandedIds]
  )

  const selectedEnvironment = useMemo(() => {
    if (!environments || environments.length === 0 || !selectedEnvId) {
      return null
    }
    return findEnvironmentById(environments, selectedEnvId)
  }, [environments, selectedEnvId])

  const selectedEnvironmentName = selectedEnvironment?.name ?? t('requestTab.environmentSelector.noEnvironment')

  if (!environments || environments.length === 0) {
    return null
  }

  return (
    <div style={{ marginLeft: 8 }}>
      <ListViewDropdown
        items={items}
        rootRole="tree"
        menuAriaLabel={t('requestTab.environmentSelector.listAriaLabel')}
        selectedIds={selectedEnvId ? [selectedEnvId] : []}
        expandedIds={expandedIds}
        buttonProps={{
          secondary: true,
          options: {
            ariaLabel: t('requestTab.environmentSelector.ariaLabel'),
            title: t('requestTab.environmentSelector.ariaLabel')
          }
        }}
        buttonContent={
          <>
            {selectedEnvironment?.icon && (
              <IconSelect value={selectedEnvironment.icon} readonly style={{ marginRight: 4 }} />
            )}
            <span style={{ marginRight: 4, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {selectedEnvironmentName}
            </span>
            <i className="codicon codicon-chevron-down" />
          </>
        }
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
            expanded ? Array.from(new Set([...prev, id])) : prev.filter((existingId) => existingId !== id)
          )
        }}
      />
    </div>
  )
}

export default EnvironmentDropdown
