import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Callout, ListView, useAuthState, type ListViewItemData } from 'electron-core-ui/renderer'
import type { FolderItem, RecordingSession, Request } from '../../../../shared/types/collections'
import { isAnyFolder, isRequest } from '../../../../shared/types/collections'
import { isRecordingDeduceLocked } from '../../../../shared/auth/planCapabilities'
import { httpBadgeIdFor } from '../../../../shared/utils/httpMethod'
import { RegistryBadge } from '../common/RegistryBadge'
import { subscribeToPro } from '../../services/subscribeToPro'
import './routesView.css'

export interface RoutesViewProps {
  session: RecordingSession
}

function countRequests(items: readonly FolderItem[]): number {
  return items.reduce((n, item) => n + (isAnyFolder(item) ? countRequests(item.items) : isRequest(item) ? 1 : 0), 0)
}

function badgeIdOf(request: Request): string {
  switch (request.type) {
    case 'graphql': return 'gql'
    case 'grpc': return 'grpc'
    case 'websocket': return 'ws'
    case 'http': return httpBadgeIdFor(request.method)
    default: return request.type
  }
}

function toRows(items: readonly FolderItem[]): ListViewItemData[] {
  return items.flatMap((item): ListViewItemData[] => {
    if (isAnyFolder(item)) {
      return [{ id: item.id, title: item.name, icon: 'folder', isExpandable: true, isExpanded: true, draggable: false, children: toRows(item.items) }]
    }
    if (!isRequest(item)) return []
    return [{ id: item.id, title: item.name, icon: <RegistryBadge badgeId={badgeIdOf(item)} />, draggable: false }]
  })
}

/**
 * The Routes node's tab: the tree of requests deduced from the captures (a
 * read-only mirror of what hangs under the Routes row in the sidebar), an
 * empty state until the first deduction — and, on the Community plan, the
 * callout saying deduction is a Pro feature.
 */
export const RoutesView: React.FC<RoutesViewProps> = ({ session }) => {
  const { t } = useTranslation()
  const locked = isRecordingDeduceLocked(useAuthState())
  const items = useMemo(() => session.items ?? [], [session.items])
  const rows = useMemo(() => toRows(items), [items])
  const total = countRequests(items)

  return (
    <div className="recording-routes" data-testid="recording-routes-view">
      {locked && (
        <Callout
          variant="info"
          className="recording-routes-callout"
          data-testid="recording-routes-pro-callout"
          message={t('recording.routes.proCallout')}
          actions={
            <Button data-testid="recording-routes-subscribe" onClick={() => { void subscribeToPro() }}>
              {t('recording.routes.subscribe')}
            </Button>
          }
        />
      )}
      {items.length === 0 ? (
        <p className="recording-tab-placeholder" data-testid="recording-routes-empty">{t('recording.routes.empty')}</p>
      ) : (
        <>
          <p className="design-section-subtitle recording-routes-summary" data-testid="recording-routes-summary">
            {t('recording.routes.count', { count: total })}
          </p>
          <div className="recording-routes-list">
            <ListView data-testid="recording-routes-list" items={rows} ariaLabel={t('recording.node.routes')} />
          </div>
          <p className="design-field-hint">{t('recording.routes.hint')}</p>
        </>
      )}
    </div>
  )
}
