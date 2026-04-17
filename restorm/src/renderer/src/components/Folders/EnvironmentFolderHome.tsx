import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { InputBox, Button, ControlGroup, useFileService, ContextMenu, type ContextMenuItem } from 'electron-core-ui/renderer'
import { getFavorites, removeFavorite, reorderFavorites } from '../../services/favoritesStore'
import type { EnvironmentFolder, FolderItem } from '../../../../shared/types/collections'
import type { ApiDocumentation } from '../../../../shared/types/apiDocumentation'
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
  swagger: { logo: '/imgs/import-sources/swagger.svg', label: 'OpenAPI / Swagger', color: '#85ea2d' },
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
  const { filePath } = useFileService()
  const [favVersion, setFavVersion] = useState(0)
  const apiDoc = (folder as unknown as { apiDocumentation?: ApiDocumentation }).apiDocumentation

  const favoriteRequests = useMemo(() => {
    void favVersion // reactivity dep
    if (!filePath) return []
    const ids = getFavorites(filePath)
    if (ids.length === 0) return []
    const allRequests = collectRequests(folder.items)
    const idSet = new Set(ids)
    return allRequests.filter((r) => idSet.has(r.id))
  }, [filePath, folder.items, favVersion])

  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [favContextMenu, setFavContextMenu] = useState<{ visible: boolean; x: number; y: number; requestId: string }>({ visible: false, x: 0, y: 0, requestId: '' })

  const handleDragStart = (index: number): void => { setDragIndex(index) }
  const handleDragOver = (e: React.DragEvent, index: number): void => { e.preventDefault(); setDropIndex(index) }
  const handleDragEnd = (): void => {
    if (dragIndex !== null && dropIndex !== null && dragIndex !== dropIndex && filePath) {
      const ids = favoriteRequests.map((r) => r.id)
      const removed = ids.splice(dragIndex, 1)
      if (removed[0]) {
        ids.splice(dropIndex, 0, removed[0])
        reorderFavorites(filePath, ids)
      }
    }
    setDragIndex(null)
    setDropIndex(null)
  }

  const handleFavContextMenu = (e: React.MouseEvent, requestId: string): void => {
    e.preventDefault()
    setFavContextMenu({ visible: true, x: e.clientX, y: e.clientY, requestId })
  }

  const handleRemoveFavorite = (): void => {
    if (filePath && favContextMenu.requestId) {
      removeFavorite(filePath, favContextMenu.requestId)
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

      {/* ── Source URL ── */}
      {apiDoc?.sourceUrl && (
        <div className="home-source-url">
          <ControlGroup>
            <InputBox
              value={apiDoc.sourceUrl}
              options={{ type: 'text', ariaLabel: 'Source URL' }}
              disabled
            />
            <Button icon="refresh" options={{ ariaLabel: t('folderView.home.refresh') }}>
              {t('folderView.home.refresh')}
            </Button>
          </ControlGroup>
        </div>
      )}

      {/* ── Favorite requests ── */}
      {favoriteRequests.length > 0 && (
        <Section title={t('folderView.home.favoriteRequests')} icon="star-full" dataTestId="home-favorites-section">
          {favoriteRequests.map((req, i) => (
            <RequestRow
              key={req.id}
              method={req.method}
              path={req.path}
              name={req.name}
              onClick={() => { onRequestClick?.(req.id) }}
              onContextMenu={(e) => { handleFavContextMenu(e, req.id) }}
              onDelete={() => {
                if (filePath) {
                  removeFavorite(filePath, req.id)
                  setFavVersion((v) => v + 1)
                }
              }}
              draggable
              onDragStart={() => { handleDragStart(i) }}
              onDragOver={(e) => { handleDragOver(e, i) }}
              onDragEnd={handleDragEnd}
              isDragOver={dropIndex === i && dragIndex !== i}
              dataTestId={`home-favorite-${req.id}`}
            />
          ))}
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

// ── Request row with method badge ──

const RequestRow: React.FC<{
  method: string; path: string; name: string
  onClick?: () => void; onContextMenu?: (e: React.MouseEvent) => void
  onDelete?: () => void
  draggable?: boolean; onDragStart?: () => void; onDragOver?: (e: React.DragEvent) => void; onDragEnd?: () => void
  isDragOver?: boolean; dataTestId?: string
}> = ({ method, path, name, onClick, onContextMenu, onDelete, draggable, onDragStart, onDragOver, onDragEnd, isDragOver, dataTestId }) => (
  <div
    className={`request-row${isDragOver ? ' drag-over' : ''}`}
    onClick={onClick}
    onContextMenu={onContextMenu}
    onDragOver={onDragOver}
    onDragEnd={onDragEnd}
    {...(dataTestId ? { 'data-testid': dataTestId } : {})}
  >
    {draggable && (
      <span
        draggable
        onDragStart={(e) => { e.stopPropagation(); onDragStart?.() }}
        className="request-row-drag"
      >⋮⋮</span>
    )}
    <Badge type={method.toUpperCase() as BadgeType} />
    <span className="request-row-name">{name}</span>
    <span className="request-row-path">{path}</span>
    {onDelete && (
      <button
        type="button"
        className="request-row-delete"
        onClick={(e) => { e.stopPropagation(); onDelete() }}
        data-testid={dataTestId ? `${dataTestId}-delete` : undefined}
      >
        <span className="codicon codicon-trash" />
      </button>
    )}
  </div>
)

export default React.memo(EnvironmentFolderHome)
