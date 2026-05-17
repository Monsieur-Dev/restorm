import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useFileService, ContextMenu, Table, type ContextMenuItem, type TableColumn } from 'electron-core-ui/renderer'
import { getFavorites, removeFavorite, reorderFavorites } from '../../services/favoritesStore'
import { PROJECT_UUID_KEY } from '../../../../shared/config/projectUuid'
import type { EnvironmentFolder, FolderItem } from '../../../../shared/types/collections'
import type { ApiDocumentation } from '../../../../shared/types/apiDocumentation'
import { ApiUpdateSettingsSection } from './ApiUpdateSettingsSection'
import { Badge, type BadgeType } from '../common/Badge'
import './environmentFolderHome.css'

interface FavoriteRequest {
  id: string
  name: string
  method: string
  path: string
}

interface Props {
  folder: EnvironmentFolder
  onSwitchTab: (tabId: string) => void
  onRequestClick?: (requestId: string) => void
}

const SOURCE_CONFIG: Record<string, { logo?: string; icon?: string; label: string; color: string }> = {
  swagger: { logo: '/imgs/import-sources/swagger.svg', label: 'OpenAPI / Swagger', color: '#c75000' },
  graphql: { logo: '/imgs/import-sources/graphql.svg', label: 'GraphQL', color: '#e535ab' },
  grpc: { logo: '/imgs/import-sources/grpc.svg', label: 'gRPC', color: '#244c5a' },
  wsdl: { icon: 'file-code', label: 'SOAP / WSDL', color: '#0076d6' },
  asyncapi: { icon: 'broadcast', label: 'AsyncAPI', color: '#764abc' },
  postman: { icon: 'mail', label: 'Collection Import', color: '#ff6c37' },
  insomnia: { icon: 'globe', label: 'Collection Import', color: '#4000bf' },
  bruno: { icon: 'beaker', label: 'Collection Import', color: '#f4aa41' },
  curl: { icon: 'terminal', label: 'cURL', color: '#073551' },
  powershell: { icon: 'terminal-powershell', label: 'PowerShell', color: '#012456' },
  url: { icon: 'link', label: 'URL Import', color: '#888' }
}

function collectRequests(items: FolderItem[], parentPath: string[] = []): FavoriteRequest[] {
  const result: FavoriteRequest[] = []
  for (const item of items) {
    if ('items' in item) {
      result.push(...collectRequests(item.items, [...parentPath, item.name]))
    } else if ('method' in item) {
      const req = item as { id: string; name: string; method: string }
      result.push({ id: req.id, name: req.name, method: req.method, path: parentPath.join(' / ') })
    }
  }
  return result
}

const EnvironmentFolderHome: React.FC<Props> = ({ folder, onSwitchTab, onRequestClick }) => {
  const { t } = useTranslation()
  const { state: fileState } = useFileService()
  const [favVersion, setFavVersion] = useState(0)
  const apiDoc = (folder as unknown as { apiDocumentation?: ApiDocumentation }).apiDocumentation

  const projectUuid = useMemo<string | null>(() => {
    const content = fileState?.currentFile.content
    if (!content || typeof content !== 'object') return null
    const raw = (content as Record<string, unknown>)[PROJECT_UUID_KEY]
    return typeof raw === 'string' && raw.length > 0 ? raw : null
  }, [fileState])

  const favoriteRequests = useMemo(() => {
    void favVersion // reactivity dep
    if (!projectUuid) return []
    const ids = getFavorites(projectUuid)
    if (ids.length === 0) return []
    const allRequests = collectRequests(folder.items)
    const requestMap = new Map(allRequests.map((r) => [r.id, r]))
    // Preserve favorites insertion order (not tree order)
    return ids.map((id) => requestMap.get(id)).filter((r): r is FavoriteRequest => r !== undefined)
  }, [projectUuid, folder.items, favVersion])

  const [favContextMenu, setFavContextMenu] = useState<{ visible: boolean; x: number; y: number; requestId: string }>({ visible: false, x: 0, y: 0, requestId: '' })

  const handleRowsReorder = useCallback((orderedIds: string[]): void => {
    if (projectUuid) reorderFavorites(projectUuid, orderedIds)
  }, [projectUuid])

  const handleFavContextMenu = (e: React.MouseEvent, requestId: string): void => {
    e.preventDefault()
    setFavContextMenu({ visible: true, x: e.clientX, y: e.clientY, requestId })
  }

  const handleRemoveFavorite = (): void => {
    if (projectUuid && favContextMenu.requestId) {
      removeFavorite(projectUuid, favContextMenu.requestId)
    }
    setFavContextMenu((prev) => ({ ...prev, visible: false }))
  }

  const favContextMenuItems: ContextMenuItem[] = [
    {
      id: 'remove-favorite',
      label: t('folderView.home.removeFavorite'),
      icon: 'star-full',
      onClick: handleRemoveFavorite
    }
  ]

  // Listen for favorite changes (custom event from favoritesStore)
  React.useEffect(() => {
    const handler = (): void => { setFavVersion((v) => v + 1) }
    window.addEventListener('restorm:favorites-changed', handler)
    window.addEventListener('storage', handler)
    return () => {
      window.removeEventListener('restorm:favorites-changed', handler)
      window.removeEventListener('storage', handler)
    }
  }, [])

  const importSource = folder.importSource
  const sourceConfig = importSource ? SOURCE_CONFIG[importSource] : undefined

  const favoriteColumns = useMemo<TableColumn<FavoriteRequest>[]>(() => [
    {
      id: 'favorite',
      header: '',
      renderCell: (req) => (
        <div
          className="home-favorite-cell"
          onClick={() => { onRequestClick?.(req.id) }}
          onContextMenu={(e) => { handleFavContextMenu(e, req.id) }}
          data-testid={`home-favorite-${req.id}`}
        >
          <Badge type={req.method.toUpperCase() as BadgeType} />
          <span className="home-favorite-name">{req.name}</span>
          <span className="home-favorite-path">{req.path}</span>
          <button
            type="button"
            className="home-favorite-delete"
            onClick={(e) => {
              e.stopPropagation()
              if (projectUuid) {
                removeFavorite(projectUuid, req.id)
                setFavVersion((v) => v + 1)
              }
            }}
            data-testid={`home-favorite-${req.id}-delete`}
          >
            <span className="codicon codicon-trash" />
          </button>
        </div>
      )
    }
  ], [onRequestClick, projectUuid])

  return (
    <div className="home-container">

      {/* ── Header: logo + title ── */}
      <div className="home-header">
        {sourceConfig && (
          sourceConfig.logo ? (
            <img src={sourceConfig.logo} alt={sourceConfig.label} className="home-logo" />
          ) : sourceConfig.icon ? (
            <div className="home-icon-badge" style={{ background: sourceConfig.color }}>
              <span className={`codicon codicon-${sourceConfig.icon}`} />
            </div>
          ) : null
        )}
        <div className="home-title-wrapper">
          <h1 className="home-title">
            {apiDoc?.api.title ?? folder.name}
            {apiDoc?.api.version && (
              <span className="home-version">v{apiDoc.api.version}</span>
            )}
          </h1>
          {sourceConfig && (
            <div>
              <span className="home-source-label" style={{ background: sourceConfig.color }}>
                {sourceConfig.label}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Separator ── */}
      <hr className="home-separator" />

      {/* ── Description ── */}
      {apiDoc?.api.description && (
        <p className="home-description">
          {apiDoc.api.description.length > 400
            ? `${apiDoc.api.description.slice(0, 400)}…`
            : apiDoc.api.description}
        </p>
      )}

      {/* ── Big action buttons ── */}
      <div className="home-actions">
        <ActionButton
          icon="settings-gear"
          label={t('folderView.home.configureEnvs')}
          description={t('folderView.home.configureEnvsDesc')}
          onClick={() => { onSwitchTab('configuration') }}
        />
        <ActionButton
          icon="book"
          label={t('folderView.home.viewDocs')}
          description={t('folderView.home.viewDocsDesc')}
          onClick={() => { onSwitchTab('docs') }}
        />
      </div>

      {/* ── API spec updates ── */}
      <ApiUpdateSettingsSection folder={folder} />

      {/* ── Favorite requests ── */}
      {favoriteRequests.length > 0 && (
        <Section title={t('folderView.home.favoriteRequests')} icon="star-full" dataTestId="home-favorites-section">
          <Table<FavoriteRequest>
            columns={favoriteColumns}
            rows={favoriteRequests}
            getRowId={(r) => r.id}
            reorderable
            onRowsReorder={handleRowsReorder}
            data-testid="home-favorites-table"
          />
        </Section>
      )}
      <ContextMenu
        visible={favContextMenu.visible}
        x={favContextMenu.x}
        y={favContextMenu.y}
        items={favContextMenuItems}
        onRequestClose={() => { setFavContextMenu((prev) => ({ ...prev, visible: false })) }}
        data-testid="home-favorites-context-menu"
      />

      {/* ── Footer: contact + source ── */}
      <div className="home-footer">
        {apiDoc?.api.contact?.email && (
          <span><span className="codicon codicon-mail" />{apiDoc.api.contact.email}</span>
        )}
        {apiDoc?.api.license && (
          <span><span className="codicon codicon-law" />{apiDoc.api.license.name}</span>
        )}
      </div>
    </div>
  )
}

// ── Action button ──

const ActionButton: React.FC<{ icon: string; label: string; description: string; onClick: () => void }> = ({ icon, label, description, onClick }) => (
  <div className="action-button" onClick={onClick}>
    <span className={`codicon codicon-${icon} action-button-icon`} />
    <div className="action-button-label">{label}</div>
    <div className="action-button-desc">{description}</div>
  </div>
)

// ── Section ──

const Section: React.FC<{ title: string; icon: string; children: React.ReactNode; dataTestId?: string }> = ({ title, icon, children, dataTestId }) => (
  <div className="home-section" {...(dataTestId ? { 'data-testid': dataTestId } : {})}>
    <h3 className="home-section-title">
      <span className={`codicon codicon-${icon}`} />
      {title}
    </h3>
    <div className="home-section-content">
      {children}
    </div>
  </div>
)

export default React.memo(EnvironmentFolderHome)
