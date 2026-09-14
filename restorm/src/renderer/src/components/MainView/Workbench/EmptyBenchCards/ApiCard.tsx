import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, eventBus, MosaicCard, Table, getColorFromString, type TableColumn } from 'electron-core-ui/renderer'
import type { EnvironmentFolder, FolderItem } from '../../../../../../shared/types/folderTypes'
import { isScenario, isApiDesign, isRecordingSession } from '../../../../../../shared/types/folderTypes'
import type { Request as RestormRequest } from '../../../../../../shared/types/requests'
import {
  addFavorite,
  getFavorites,
  isFavorite as isFavoriteCheck,
  removeFavorite,
  reorderFavorites
} from '../../../../services/favoritesStore'
import { DocumentEvents, type DocumentChangedPayload } from '../../../../services/DocumentEvents'
import { setPendingEnvFolderSubTab } from '../../../../services/envFolderTabIntent'
import { useRequestUsage, type RequestUsageMap } from '../../../../hooks/useRequestUsage'
import { useScenarioUsage, type ScenarioUsageMap } from '../../../../hooks/useScenarioUsage'
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
  /** Badge method for requests; 'scenario' for scenarios (→ scenario glyph). */
  method: string
  kind: 'request' | 'scenario'
}

const TOP_PLAYED_LIMIT = 10
const RECENT_LIMIT = 10

/** Collect both requests and scenarios under an env-folder. Scenarios are
 *  folder-like (optional `items`); we index the scenario itself AND recurse
 *  into its children. */
function collectItems(items: FolderItem[]): RequestRow[] {
  const result: RequestRow[] = []
  for (const item of items) {
    if (isScenario(item)) {
      result.push({ id: item.id, name: item.name, method: 'scenario', kind: 'scenario' })
      if (item.items) result.push(...collectItems(item.items))
    } else if (isApiDesign(item)) {
      // A design is neither a request row nor a container of them.
    } else if (isRecordingSession(item)) {
      // A session's deduced routes are ordinary requests — list them.
      if (item.items) result.push(...collectItems(item.items))
    } else if ('items' in item) {
      result.push(...collectItems(item.items))
    } else {
      const req: RestormRequest = item
      const method = 'method' in req && typeof req.method === 'string'
        ? req.method
        : 'type' in req
          ? req.type
          : ''
      result.push({ id: req.id, name: req.name, method, kind: 'request' })
    }
  }
  return result
}

/** A row's run/send count, read from the map matching its kind. */
function usageCount(row: RequestRow, requestUsage: RequestUsageMap, scenarioUsage: ScenarioUsageMap): number {
  return row.kind === 'scenario'
    ? scenarioUsage[row.id]?.count ?? 0
    : requestUsage[row.id]?.count ?? 0
}

/** A row's last-activity ISO timestamp (request send / scenario run). */
function usageAt(row: RequestRow, requestUsage: RequestUsageMap, scenarioUsage: ScenarioUsageMap): string {
  return row.kind === 'scenario'
    ? scenarioUsage[row.id]?.lastRunAt ?? ''
    : requestUsage[row.id]?.lastSentAt ?? ''
}

function rankTopPlayed(rows: RequestRow[], requestUsage: RequestUsageMap, scenarioUsage: ScenarioUsageMap): { row: RequestRow; count: number }[] {
  return rows
    .map((row) => ({ row, count: usageCount(row, requestUsage, scenarioUsage) }))
    .filter(({ count }) => count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_PLAYED_LIMIT)
}

function rankRecent(rows: RequestRow[], requestUsage: RequestUsageMap, scenarioUsage: ScenarioUsageMap): { row: RequestRow; at: string }[] {
  return rows
    .map((row) => ({ row, at: usageAt(row, requestUsage, scenarioUsage) }))
    .filter(({ at }) => at !== '')
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, RECENT_LIMIT)
}

export const ApiCard: React.FC<ApiCardProps> = ({ folder, projectUuid, onOpenRequest }) => {
  const { t } = useTranslation()
  const [favVersion, setFavVersion] = useState(0)
  const usage = useRequestUsage()
  const scenarioUsage = useScenarioUsage()

  // Bumped on every FOLDER_UPDATED event that names this env-folder
  // — `folder` itself is a reactive proxy that mutates in place, so
  // React's prop comparison sees the same reference even when the
  // sidebar rename writes a new `folder.name`. The version is a
  // dummy state whose only job is to re-pull `folder.name` for the
  // banner title.
  const [folderVersion, setFolderVersion] = useState(0)
  useEffect(() => {
    const sub = eventBus.subscribe<DocumentChangedPayload>(
      DocumentEvents.FOLDER_UPDATED,
      (payload) => {
        if (payload.id === folder.id) setFolderVersion((v) => v + 1)
      }
    )
    return () => { sub.unsubscribe() }
  }, [folder.id])

  const apiInfo = folder.apiDocumentation?.api
  // Title follows the env-folder rename: the spec title (when present)
  // is only the import-time hint, the folder name is the user's
  // identifier and what the sidebar surfaces.
  void folderVersion
  const displayName = (folder.name && folder.name.length > 0)
    ? folder.name
    : apiInfo?.title ?? ''
  // Banner colour is keyed off the folder id (stable across renames)
  // rather than the displayed name so rebranding doesn't reshuffle
  // the card's accent.
  const bannerBg = getColorFromString(folder.id)

  useEffect(() => {
    const handler = (): void => { setFavVersion((v) => v + 1) }
    window.addEventListener('restorm:favorites-changed', handler)
    window.addEventListener('storage', handler)
    return () => {
      window.removeEventListener('restorm:favorites-changed', handler)
      window.removeEventListener('storage', handler)
    }
  }, [])

  const allItems = useMemo(() => collectItems(folder.items), [folder.items])
  // Favourites are request-scoped (the env-folder favourites table only lists
  // requests), so index just the request rows for the favourites lookup.
  const requestsById = useMemo(
    () => new Map(allItems.filter((r) => r.kind === 'request').map((r) => [r.id, r])),
    [allItems]
  )

  const favorites = useMemo<RequestRow[]>(() => {
    void favVersion
    if (!projectUuid) return []
    const favIds = getFavorites(projectUuid)
    if (favIds.length === 0) return []
    return favIds.map((id) => requestsById.get(id)).filter((r): r is RequestRow => r !== undefined)
  }, [projectUuid, requestsById, favVersion])

  const topPlayed = useMemo(() => rankTopPlayed(allItems, usage, scenarioUsage), [allItems, usage, scenarioUsage])
  const recent = useMemo(() => rankRecent(allItems, usage, scenarioUsage), [allItems, usage, scenarioUsage])

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

  const recentColumns = useMemo<TableColumn<{ row: RequestRow; at: string }>[]>(() => [
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

      {/*
        * Quick links to the three env-folder sub-tabs. Each click
        * stages the desired sub-tab id via `envFolderTabIntent`,
        * then hands off to the generic `onOpenRequest` (which
        * `useNavigation.handleItemClick` routes by id type — folder
        * id → env-folder tab). The view drains the staged intent on
        * mount (cold-open) AND via a live subscription (hot-open
        * when the env-folder tab is already on screen).
        */}
      <div className="empty-bench-quick-links" data-testid={`empty-bench-card-api-${folder.id}-quick-links`}>
        <Button
          secondary
          onClick={() => {
            setPendingEnvFolderSubTab(folder.id, 'environments')
            onOpenRequest(folder.id)
          }}
          data-testid={`empty-bench-card-api-${folder.id}-quick-environments`}
        >
          {t('emptyBench.apiCard.quickLinks.environments', 'Environments')}
        </Button>
        {folder.apiDocumentation ? (
          <Button
            secondary
            onClick={() => {
              setPendingEnvFolderSubTab(folder.id, 'docs')
              onOpenRequest(folder.id)
            }}
            data-testid={`empty-bench-card-api-${folder.id}-quick-docs`}
          >
            {t('emptyBench.apiCard.quickLinks.docs', 'Documentation')}
          </Button>
        ) : null}
        <Button
          secondary
          onClick={() => {
            setPendingEnvFolderSubTab(folder.id, 'notes')
            onOpenRequest(folder.id)
          }}
          data-testid={`empty-bench-card-api-${folder.id}-quick-notes`}
        >
          {t('emptyBench.apiCard.quickLinks.notes', 'Notes')}
        </Button>
      </div>

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
          <Table<{ row: RequestRow; at: string }>
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
