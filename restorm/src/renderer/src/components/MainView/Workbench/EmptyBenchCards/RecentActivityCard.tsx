import React, { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { MosaicCard, Table, type TableColumn } from 'electron-core-ui/renderer'
import {
  isEnvironmentFolder,
  type EnvironmentFolder,
  type Folder,
  type FolderItem
} from '../../../../../../shared/types/folderTypes'
import type { Request as RestormRequest } from '../../../../../../shared/types/requests'
import {
  addFavorite,
  isFavorite as isFavoriteCheck,
  removeFavorite
} from '../../../../services/favoritesStore'
import { useRequestUsage } from '../../../../hooks/useRequestUsage'
import { RequestListRow } from './RequestListRow'

/**
 * `RecentActivityCard` — the freshest 10 requests fired across every
 * env-folder of the open project. Powered by the user-level
 * `RequestUsageService`; only requests still present in the open
 * project's tree are listed (orphan entries from other projects are
 * silently skipped).
 *
 * Each row shows: method badge + request name + (italic, right-
 * aligned, smaller) parent API name + star Toggle. The card is
 * **not rendered** when there's no recent activity — so a fresh
 * project doesn't show an empty teaser block.
 */

const RECENT_LIMIT = 10

interface RecentRow {
  id: string
  method: string
  name: string
  apiName: string
  lastSentAt: string
}

interface RequestIndexEntry {
  method: string
  name: string
  apiName: string
}

function indexRequests(
  items: FolderItem[],
  apiName: string,
  out: Map<string, RequestIndexEntry>
): void {
  for (const item of items) {
    if ('items' in item) {
      indexRequests(item.items, apiName, out)
    } else {
      const req: RestormRequest = item
      const method = 'method' in req && typeof req.method === 'string'
        ? req.method
        : 'type' in req
          ? req.type
          : ''
      out.set(req.id, { method, name: req.name, apiName })
    }
  }
}

interface RecentActivityCardProps {
  readonly rootItems: readonly (EnvironmentFolder | Folder | RestormRequest)[]
  /** Open a request in the workbench when its row is clicked. */
  readonly onOpenRequest: (requestId: string) => void
  /** Project UUID — scopes the star toggle's favourite store
   *  reads/writes. */
  readonly projectUuid: string | null
}

export const RecentActivityCard: React.FC<RecentActivityCardProps> = ({ rootItems, onOpenRequest, projectUuid }) => {
  const { t } = useTranslation()
  const usage = useRequestUsage()

  const requestIndex = useMemo(() => {
    const index = new Map<string, RequestIndexEntry>()
    for (const item of rootItems) {
      if (isEnvironmentFolder(item)) {
        const apiName = item.apiDocumentation?.api.title ?? item.name
        indexRequests(item.items, apiName, index)
      }
    }
    return index
  }, [rootItems])

  const recent = useMemo<RecentRow[]>(() => {
    const rows: RecentRow[] = []
    for (const [requestId, entry] of Object.entries(usage)) {
      const meta = requestIndex.get(requestId)
      if (!meta) continue
      rows.push({
        id: requestId,
        method: meta.method,
        name: meta.name,
        apiName: meta.apiName,
        lastSentAt: entry.lastSentAt
      })
    }
    return rows
      .sort((a, b) => b.lastSentAt.localeCompare(a.lastSentAt))
      .slice(0, RECENT_LIMIT)
  }, [usage, requestIndex])

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

export default RecentActivityCard
