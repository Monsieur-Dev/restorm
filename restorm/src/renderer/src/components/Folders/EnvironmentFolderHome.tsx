import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { InputBox, Button, ControlGroup, useFileService, ContextMenu, type ContextMenuItem } from 'electron-core-ui/renderer'
import { getFavorites, removeFavorite, reorderFavorites } from '../../services/favoritesStore'
import type { EnvironmentFolder, FolderItem } from '../../../../shared/types/collections'
import type { ApiDocumentation } from '../../../../shared/types/apiDocumentation'
import { Badge, type BadgeType } from '../common/Badge'

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
    <div style={{ padding: '32px', maxWidth: 640, margin: '0 auto' }}>

      {/* ── Header: logo + title ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
        {sourceConfig && (
          sourceConfig.logo ? (
            <img src={sourceConfig.logo} alt={sourceConfig.label} style={{ width: 48, height: 48, flexShrink: 0 }} />
          ) : sourceConfig.icon ? (
            <div style={{
              width: 48, height: 48, borderRadius: 10, background: sourceConfig.color, color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, flexShrink: 0
            }}>
              <span className={`codicon codicon-${sourceConfig.icon}`} />
            </div>
          ) : null
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, lineHeight: 1.3 }}>
            {apiDoc?.api.title ?? folder.name}
            {apiDoc?.api.version && (
              <span style={{ fontSize: 12, fontWeight: 400, opacity: 0.5, marginLeft: 8 }}>v{apiDoc.api.version}</span>
            )}
          </h1>
          {sourceConfig && (
            <div style={{ marginTop: 4 }}>
              <span style={{
                background: sourceConfig.color, color: '#fff',
                padding: '1px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500
              }}>
                {sourceConfig.label}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Separator ── */}
      <hr style={{ border: 'none', borderTop: '1px solid var(--panel-border)', margin: '0 0 20px' }} />

      {/* ── Description ── */}
      {apiDoc?.api.description && (
        <p style={{ margin: '0 0 24px', fontSize: 13, lineHeight: 1.7, opacity: 0.7 }}>
          {apiDoc.api.description.length > 400
            ? `${apiDoc.api.description.slice(0, 400)}…`
            : apiDoc.api.description}
        </p>
      )}

      {/* ── Big action buttons ── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 32 }}>
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
        <div style={{ marginBottom: 32 }}>
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
      <div style={{ marginTop: 24, fontSize: 11, opacity: 0.4, display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
        {apiDoc?.api.contact?.email && (
          <span><span className="codicon codicon-mail" style={{ marginRight: 4 }} />{apiDoc.api.contact.email}</span>
        )}
        {apiDoc?.api.license && (
          <span><span className="codicon codicon-law" style={{ marginRight: 4 }} />{apiDoc.api.license.name}</span>
        )}
      </div>
    </div>
  )
}

// ── Action button ──

const ActionButton: React.FC<{ icon: string; label: string; description: string; onClick: () => void }> = ({ icon, label, description, onClick }) => (
  <div
    onClick={onClick}
    style={{
      flex: 1, padding: '20px', borderRadius: 10,
      border: '1px solid var(--panel-border)', background: 'var(--editor-background)',
      cursor: 'pointer', transition: 'border-color 0.15s', textAlign: 'center'
    }}
    onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--focusBorder)' }}
    onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--panel-border)' }}
  >
    <span className={`codicon codicon-${icon}`} style={{ fontSize: 28, opacity: 0.6, display: 'block', marginBottom: 10 }} />
    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{label}</div>
    <div style={{ fontSize: 11, opacity: 0.5 }}>{description}</div>
  </div>
)

// ── Section ──

const Section: React.FC<{ title: string; icon: string; children: React.ReactNode; dataTestId?: string }> = ({ title, icon, children, dataTestId }) => (
  <div style={{ marginBottom: 24 }} {...(dataTestId ? { 'data-testid': dataTestId } : {})}>
    <h3 style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', opacity: 0.4, letterSpacing: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
      <span className={`codicon codicon-${icon}`} style={{ fontSize: 14 }} />
      {title}
    </h3>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {children}
    </div>
  </div>
)

// ── Request row with method badge ──

const RequestRow: React.FC<{
  method: string; path: string; name: string
  onClick?: () => void; onContextMenu?: (e: React.MouseEvent) => void
  draggable?: boolean; onDragStart?: () => void; onDragOver?: (e: React.DragEvent) => void; onDragEnd?: () => void
  isDragOver?: boolean; dataTestId?: string
}> = ({ method, path, name, onClick, onContextMenu, draggable, onDragStart, onDragOver, onDragEnd, isDragOver, dataTestId }) => (
  <div
    style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px',
      borderRadius: 6, cursor: 'pointer', fontSize: 13,
      borderTop: isDragOver ? '2px solid var(--focusBorder)' : '2px solid transparent'
    }}
    onClick={onClick}
    onContextMenu={onContextMenu}
    onDragOver={onDragOver}
    onDragEnd={onDragEnd}
    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--list-hoverBackground)' }}
    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    {...(dataTestId ? { 'data-testid': dataTestId } : {})}
  >
    {draggable && (
      <span
        draggable
        onDragStart={(e) => { e.stopPropagation(); onDragStart?.() }}
        style={{ cursor: 'grab', opacity: 0.4, fontSize: 12, userSelect: 'none', lineHeight: 1 }}
      >⋮⋮</span>
    )}
    <Badge type={method.toUpperCase() as BadgeType} />
    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
    <span style={{ fontSize: 11, opacity: 0.35, fontFamily: 'monospace' }}>{path}</span>
  </div>
)

export default React.memo(EnvironmentFolderHome)
