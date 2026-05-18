import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, eventBus } from 'electron-core-ui/renderer'
import { DocumentEvents, type DocumentChangedPayload } from '../../services/DocumentEvents'
import { ApiSpecRefreshFlow } from './ApiSpecRefreshFlow'
import type { ApiUpdateConfig } from '../../../../shared/types/baseTypes'
import type { EnvironmentFolder } from '../../../../shared/types/folderTypes'

/**
 * Read-only summary of the env folder's API spec import state plus a
 * single "Refresh" button. The actual refresh logic lives in
 * `<ApiSpecRefreshFlow>` — this section just owns the trigger button
 * and the field-rendering. The sidebar context-menu's Refresh entry
 * uses the same flow so the two surfaces behave identically.
 */
interface Props {
  folder: EnvironmentFolder
}

export const ApiUpdateSettingsSection: React.FC<Props> = ({ folder }) => {
  const { t } = useTranslation()
  const [refreshing, setRefreshing] = useState(false)
  // Bumped on every FOLDER_UPDATED for this folder so we re-read the
  // proxy's `apiUpdate` field after `persistPatch` / refresh-from-source
  // mutations. Without the bump the section keeps showing the stale
  // `lastCheckedAt` / `payloadChecksum` until the next external rerender.
  const [, forceRender] = useState(0)

  const folderId = folder.id

  useEffect(() => {
    const subscription = eventBus.subscribe<DocumentChangedPayload>(
      DocumentEvents.FOLDER_UPDATED,
      (payload) => {
        if (payload.id !== folderId) return
        forceRender((seq) => seq + 1)
      }
    )
    return () => { subscription.unsubscribe() }
  }, [folderId])

  const config = (folder as unknown as { apiUpdate?: ApiUpdateConfig }).apiUpdate

  const handleRefresh = useCallback(() => { setRefreshing(true) }, [])
  const handleDismiss = useCallback(() => { setRefreshing(false) }, [])
  const handleOpenRefreshModal = useCallback((fId: string) => {
    // Defer to App's existing handler — owns the Import modal state.
    window.dispatchEvent(new CustomEvent('restorm:open-import-refresh', { detail: { folderId: fId } }))
  }, [])

  if (!config?.sourceUrl) {
    return (
      <div className="home-section" data-testid="home-api-update-section">
        <h3 className="home-section-title">
          <span className="codicon codicon-cloud-download" />
          {t('folderView.home.apiUpdate.title')}
        </h3>
        <div className="home-section-content">
          <p>{t('folderView.home.apiUpdate.noConfig')}</p>
        </div>
      </div>
    )
  }

  const lastImportedText = config.lastImportedAt !== undefined
    ? new Date(config.lastImportedAt).toLocaleString()
    : t('folderView.home.apiUpdate.neverImported')
  // Fallback to the import timestamp when the user hasn't pinged the
  // source yet — importing IS the first successful check, so showing
  // "Never checked" right after an import is confusing.
  const effectiveLastChecked = config.lastCheckedAt ?? config.lastImportedAt
  const lastCheckedText = effectiveLastChecked !== undefined
    ? new Date(effectiveLastChecked).toLocaleString()
    : t('folderView.home.apiUpdate.neverChecked')

  return (
    <div className="home-section" data-testid="home-api-update-section">
      <h3 className="home-section-title">
        <span className="codicon codicon-cloud-download" />
        {t('folderView.home.apiUpdate.title')}
      </h3>
      <div className="home-section-content api-update-grid">
        <div className="api-update-row">
          <span className="api-update-label">{t('folderView.home.apiUpdate.urlLabel')}</span>
          <span data-testid="home-api-update-url">{config.sourceUrl}</span>
        </div>
        <div className="api-update-row">
          <span className="api-update-label">{t('folderView.home.apiUpdate.lastImportedLabel')}</span>
          <span data-testid="home-api-update-last-imported">{lastImportedText}</span>
        </div>
        <div className="api-update-row">
          <span className="api-update-label">{t('folderView.home.apiUpdate.lastCheckedLabel')}</span>
          <span data-testid="home-api-update-last-checked">{lastCheckedText}</span>
        </div>
        <div>
          <Button
            icon="refresh"
            onClick={handleRefresh}
            disabled={refreshing}
            data-testid="home-api-update-refresh"
          >
            {t('common.refresh')}
          </Button>
        </div>
      </div>

      {refreshing && (
        <ApiSpecRefreshFlow
          folder={folder}
          onDismiss={handleDismiss}
          onOpenRefreshModal={handleOpenRefreshModal}
          testIdPrefix="home-api-update-refresh"
        />
      )}
    </div>
  )
}
