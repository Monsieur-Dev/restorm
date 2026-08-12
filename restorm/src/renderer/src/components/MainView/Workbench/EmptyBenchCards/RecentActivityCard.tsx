import React, { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { MosaicCard, Table, type TableColumn } from 'electron-core-ui/renderer'
import {
  isEnvironmentFolder,
  isScenario,
  type FolderItem
} from '../../../../../../shared/types/folderTypes'
import type { Request as RestormRequest } from '../../../../../../shared/types/requests'
import {
  addFavorite,
  isFavorite as isFavoriteCheck,
  removeFavorite
} from '../../../../services/favoritesStore'
import { useRequestUsage } from '../../../../hooks/useRequestUsage'
import { useScenarioUsage } from '../../../../hooks/useScenarioUsage'
import { RequestListRow } from './RequestListRow'

/**
 * `RecentActivityCard` — the freshest 10 items touched across the open
 * project: requests fired (via `RequestUsageService`) and scenarios run (via
 * `ScenarioUsageService`), merged and sorted by recency. Only items still
 * present in the open project's tree are listed (orphan usage entries from
 * other projects are silently skipped).
 *
 * Each row shows: method badge (or scenario glyph) + name + (italic, right-
 * aligned, smaller) parent API name + star Toggle. The card is **not
 * rendered** when there's no recent activity — so a fresh project doesn't show
 * an empty teaser block.
 */

const RECENT_LIMIT = 10

interface RecentRow {
  id: string
  kind: 'request' | 'scenario'
  /** Badge method for requests; 'scenario' for scenarios (→ scenario glyph). */
  method: string
  name: string
  apiName: string
  /** ISO timestamp of the last send (request) or run (scenario). */
  at: string
}

interface ItemIndexEntry {
  kind: 'request' | 'scenario'
  method: string
  name: string
  apiName: string
}

/** Walk the whole tree, indexing requests and scenarios by id. `apiName` is the
 *  nearest enclosing env-folder's title (empty above any env-folder). */
function indexItems(
  items: readonly FolderItem[],
  apiName: string,
  out: Map<string, ItemIndexEntry>
): void {
  for (const item of items) {
    if (isEnvironmentFolder(item)) {
      const name = item.apiDocumentation?.api.title ?? item.name
      indexItems(item.items, name, out)
    } else if (isScenario(item)) {
      out.set(item.id, { kind: 'scenario', method: 'scenario', name: item.name, apiName })
      if (item.items) indexItems(item.items, apiName, out)
    } else if ('items' in item) {
      indexItems(item.items, apiName, out)
    } else {
      const req: RestormRequest = item
      const method = 'method' in req && typeof req.method === 'string'
        ? req.method
        : 'type' in req
          ? req.type
          : ''
      out.set(req.id, { kind: 'request', method, name: req.name, apiName })
    }
  }
}

interface RecentActivityCardProps {
  readonly rootItems: readonly FolderItem[]
  /** Open a request OR scenario in the workbench when its row is clicked.
   *  Wired to `useNavigation.handleItemClick`, which routes by id type. */
  readonly onOpenRequest: (requestId: string) => void
  /** Project UUID — scopes the star toggle's favourite store
   *  reads/writes. */
  readonly projectUuid: string | null
}

export const RecentActivityCard: React.FC<RecentActivityCardProps> = ({ rootItems, onOpenRequest, projectUuid }) => {
  const { t } = useTranslation()
  const requestUsage = useRequestUsage()
  const scenarioUsage = useScenarioUsage()

  const itemIndex = useMemo(() => {
    const index = new Map<string, ItemIndexEntry>()
    indexItems(rootItems, '', index)
    return index
  }, [rootItems])

  const recent = useMemo<RecentRow[]>(() => {
    const rows: RecentRow[] = []
    for (const [requestId, entry] of Object.entries(requestUsage)) {
      const meta = itemIndex.get(requestId)
      if (meta?.kind !== 'request') continue
      rows.push({ id: requestId, kind: 'request', method: meta.method, name: meta.name, apiName: meta.apiName, at: entry.lastSentAt })
    }
    for (const [scenarioId, entry] of Object.entries(scenarioUsage)) {
      const meta = itemIndex.get(scenarioId)
      if (meta?.kind !== 'scenario') continue
      rows.push({ id: scenarioId, kind: 'scenario', method: 'scenario', name: meta.name, apiName: meta.apiName, at: entry.lastRunAt })
    }
    return rows
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, RECENT_LIMIT)
  }, [requestUsage, scenarioUsage, itemIndex])

  const handleToggleFavorite = useCallback((requestId: string, next: boolean): void => {
    if (!projectUuid) return
    if (next) addFavorite(projectUuid, requestId)
    else removeFavorite(projectUuid, requestId)
  }, [projectUuid])

  const columns = useMemo<TableColumn<RecentRow>[]>(() => [
    {
      id: 'row',
      header: '',
      renderCell: (row) => (
        <RequestListRow
          id={row.id}
          name={row.name}
          method={row.method}
          isFavorite={projectUuid ? isFavoriteCheck(projectUuid, row.id) : false}
          onOpen={() => { onOpenRequest(row.id) }}
          onToggleFavorite={(next) => { handleToggleFavorite(row.id, next) }}
          trailing={row.apiName}
        />
      )
    }
  ], [projectUuid, onOpenRequest, handleToggleFavorite])

  if (recent.length === 0) {
    return null
  }

  return (
    <MosaicCard
      title={t('emptyBench.recentActivity.title', 'Recent activity')}
      titleBackgroundColor="#3b82f6"
      data-testid="empty-bench-card-recent"
    >
      <Table<RecentRow>
        columns={columns}
        rows={recent}
        getRowId={(r) => r.id}
        data-testid="empty-bench-card-recent-table"
      />
    </MosaicCard>
  )
}
