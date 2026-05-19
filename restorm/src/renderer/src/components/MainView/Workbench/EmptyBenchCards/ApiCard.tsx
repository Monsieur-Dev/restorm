import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MosaicCard, Table, getColorFromString, type TableColumn } from 'electron-core-ui/renderer'
import type { EnvironmentFolder, FolderItem } from '../../../../../../shared/types/folderTypes'
import type { Request as RestormRequest } from '../../../../../../shared/types/requests'
import {
  addFavorite,
  getFavorites,
  isFavorite as isFavoriteCheck,
  removeFavorite,
  reorderFavorites
} from '../../../../services/favoritesStore'
import { useRequestUsage, type RequestUsageMap } from '../../../../hooks/useRequestUsage'
import { RequestListRow } from './RequestListRow'

/**
 * `ApiCard` — one tile per env-folder (= one imported API) in the
 * open project. Title colour is hashed from the folder name; the
 * title-text colour is auto-picked white/black for contrast by
 * MosaicCard.
 *
 * Sections, in order (each section only renders when it has data):
 *   - description + version (read from `apiDocumentation.api`)
 *   - favourites — reorderable when more than 1 row; follows
 *     `restorm:favorites-changed` to refresh
 *   - top played — count column, **not** reorderable
 *   - last played — chronological, **not** reorderable
 *
 * Each row is an ECUI `Table` (single column) rendering the shared
 * `RequestListRow`: badge + name + optional trailing + star Toggle.
 */

export interface ApiCardProps {
  folder: EnvironmentFolder
  projectUuid: string | null
  onOpenRequest: (requestId: string) => void
}

interface RequestRow {
  id: string
  name: string
  method: string
}

const TOP_PLAYED_LIMIT = 10
const RECENT_LIMIT = 10

function collectRequests(items: FolderItem[]): RequestRow[] {
  const result: RequestRow[] = []
  for (const item of items) {
    if ('items' in item) {
      result.push(...collectRequests(item.items))
    } else {
      const req: RestormRequest = item
      const method = 'method' in req && typeof req.method === 'string'
        ? req.method
        : 'type' in req
          ? req.type
          : ''
      result.push({ id: req.id, name: req.name, method })
    }
  }
  return result
}

function rankTopPlayed(rows: RequestRow[], usage: RequestUsageMap): { row: RequestRow; count: number }[] {
  return rows
    .map((row) => ({ row, count: usage[row.id]?.count ?? 0 }))
    .filter(({ count }) => count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_PLAYED_LIMIT)
}

function rankRecent(rows: RequestRow[], usage: RequestUsageMap): { row: RequestRow; lastSentAt: string }[] {
  return rows
    .map((row) => ({ row, lastSentAt: usage[row.id]?.lastSentAt ?? '' }))
    .filter(({ lastSentAt }) => lastSentAt !== '')
    .sort((a, b) => b.lastSentAt.localeCompare(a.lastSentAt))
    .slice(0, RECENT_LIMIT)
}

export const ApiCard: React.FC<ApiCardProps> = ({ folder, projectUuid, onOpenRequest }) => {
  const { t } = useTranslation()
  const [favVersion, setFavVersion] = useState(0)
  const usage = useRequestUsage()

  const apiInfo = folder.apiDocumentation?.api
  const displayName = apiInfo?.title ?? folder.name
  const bannerBg = getColorFromString(displayName)

  useEffect(() => {
    const handler = (): void => { setFavVersion((v) => v + 1) }
    window.addEventListener('restorm:favorites-changed', handler)
    window.addEventListener('storage', handler)
    return () => {
      window.removeEventListener('restorm:favorites-changed', handler)
      window.removeEventListener('storage', handler)
    }
  }, [])

  const allRequests = useMemo(() => collectRequests(folder.items), [folder.items])
  const requestsById = useMemo(() => new Map(allRequests.map((r) => [r.id, r])), [allRequests])

  const favorites = useMemo<RequestRow[]>(() => {
    void favVersion
    if (!projectUuid) return []
    const favIds = getFavorites(projectUuid)
    if (favIds.length === 0) return []
    return favIds.map((id) => requestsById.get(id)).filter((r): r is RequestRow => r !== undefined)
  }, [projectUuid, requestsById, favVersion])

  const topPlayed = useMemo(() => rankTopPlayed(allRequests, usage), [allRequests, usage])
  const recent = useMemo(() => rankRecent(allRequests, usage), [allRequests, usage])

  const handleToggleFavorite = useCallback((requestId: string, next: boolean): void => {
    if (!projectUuid) return
    if (next) addFavorite(projectUuid, requestId)
    else removeFavorite(projectUuid, requestId)
  }, [projectUuid])

  const handleFavoritesReorder = useCallback((orderedIds: string[]): void => {
    if (projectUuid) reorderFavorites(projectUuid, orderedIds)
  }, [projectUuid])

  const renderRow = useCallback((row: RequestRow, trailing?: React.ReactNode) => {
    void favVersion // reactivity dep — favorites store reads in JSX below
    return (
      <RequestListRow
        id={row.id}
        name={row.name}
        method={row.method}
        isFavorite={projectUuid ? isFavoriteCheck(projectUuid, row.id) : false}
        onOpen={() => { onOpenRequest(row.id) }}
        onToggleFavorite={(next) => { handleToggleFavorite(row.id, next) }}
        trailing={trailing}
      />
    )
  }, [projectUuid, favVersion, onOpenRequest, handleToggleFavorite])

  const favoritesColumns = useMemo<TableColumn<RequestRow>[]>(() => [
    { id: 'row', header: '', renderCell: (row) => renderRow(row) }
  ], [renderRow])

  const topPlayedColumns = useMemo<TableColumn<{ row: RequestRow; count: number }>[]>(() => [
    {
      id: 'row',
      header: '',
      renderCell: ({ row, count }) => renderRow(row, <span className="empty-bench-list__count">{count}</span>)
    }
  ], [renderRow])

  const recentColumns = useMemo<TableColumn<{ row: RequestRow; lastSentAt: string }>[]>(() => [
    { id: 'row', header: '', renderCell: ({ row }) => renderRow(row) }
  ], [renderRow])

  return (
    <MosaicCard
      title={displayName}
      titleBackgroundColor={bannerBg}
      data-testid={`empty-bench-card-api-${folder.id}`}
    >
      {apiInfo?.description ? (
        <p className="empty-bench-description">{apiInfo.description}</p>
      ) : null}

      {apiInfo?.version ? (
        <p className="empty-bench-meta-row">
          <span className="empty-bench-meta-label">{t('emptyBench.apiCard.version', 'Version')}</span>
          <span className="empty-bench-meta-value">{apiInfo.version}</span>
        </p>
      ) : null}

      {favorites.length > 0 && (
        <section>
          <h3 className="empty-bench-subtitle">{t('emptyBench.apiCard.favorites', 'Favorites')}</h3>
          <Table<RequestRow>
            columns={favoritesColumns}
            rows={favorites}
            getRowId={(r) => r.id}
            reorderable={favorites.length > 1}
            onRowsReorder={handleFavoritesReorder}
            data-testid={`empty-bench-card-api-${folder.id}-favorites`}
          />
        </section>
      )}

      {topPlayed.length > 0 && (
        <section>
          <h3 className="empty-bench-subtitle">{t('emptyBench.apiCard.topUsed', 'Top played')}</h3>
          <Table<{ row: RequestRow; count: number }>
            columns={topPlayedColumns}
            rows={topPlayed}
            getRowId={(r) => r.row.id}
            data-testid={`empty-bench-card-api-${folder.id}-top`}
          />
        </section>
      )}

      {recent.length > 0 && (
        <section>
          <h3 className="empty-bench-subtitle">{t('emptyBench.apiCard.recent', 'Last played')}</h3>
          <Table<{ row: RequestRow; lastSentAt: string }>
            columns={recentColumns}
            rows={recent}
            getRowId={(r) => r.row.id}
            data-testid={`empty-bench-card-api-${folder.id}-recent`}
          />
        </section>
      )}
    </MosaicCard>
  )
}

export default ApiCard
