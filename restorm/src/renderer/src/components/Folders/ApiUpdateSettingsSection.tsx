import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Modal, logger, eventBus } from 'electron-core-ui/renderer'
import { DocumentEvents, type DocumentChangedPayload } from '../../services/DocumentEvents'
import { updateReactiveProperty } from '../RequestTabViews/requestTabViewUtils'
import type { ApiUpdateConfig } from '../../../../shared/types/baseTypes'
import type { EnvironmentFolder } from '../../../../shared/types/folderTypes'

/**
 * Read-only summary of the env folder's API spec import state plus a
 * single "Refresh" button.
 *
 * The Refresh flow:
 *   1. Open a local "Refreshing API spec…" modal.
 *   2. Call `apiUpdate.refreshFetch(folderId)` which hits the source
 *      URL with the env folder's expanded headers + the resolved auth
 *      headers, hashes the body and returns the checksum.
 *   3. Bump `lastCheckedAt` on the folder (reactive mutation +
 *      `apiUpdate:set-settings` IPC).
 *   4. If the checksum matches `apiUpdate.payloadChecksum` → show
 *      "API spec is up to date." with an OK button. Done.
 *   5. Otherwise (or on fetch error) → close this modal and dispatch
 *      a `restorm:open-import-refresh` event so App can pop the
 *      Import modal in "Refresh from source" mode, exactly like the
 *      sidebar context-menu entry does.
 */
interface Props {
  folder: EnvironmentFolder
}

interface ApiUpdateApi {
  setSettings: (folderId: string, config: Partial<ApiUpdateConfig>) => Promise<void>
  refreshFetch: (folderId: string) => Promise<{ ok: true; checksum: string; payload: string } | { ok: false; error: string }>
}

function getApiUpdateApi(): ApiUpdateApi | null {
  const api = (window as unknown as { restorm?: { apiUpdate?: ApiUpdateApi } }).restorm?.apiUpdate
  return api ?? null
}

type RefreshPhase = 'idle' | 'fetching' | 'up-to-date'

export const ApiUpdateSettingsSection: React.FC<Props> = ({ folder }) => {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<RefreshPhase>('idle')
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

  const closeModal = useCallback(() => { setPhase('idle') }, [])

  const persistPatch = useCallback((patch: Partial<ApiUpdateConfig>) => {
    // Mutate the reactive folder proxy. `apiUpdate` lives in
    // FOLDER_INDEXABLE_KEYS, so the proxy set trap fires
    // FOLDER_UPDATED → the save-unit upsert pipeline → disk. Going
    // through `updateReactiveProperty` (Object.assign) keeps the
    // eslint-react immutability rule happy while still triggering
    // the proxy.
    const nextApiUpdate = { ...(config ?? {}), ...patch }
    updateReactiveProperty(folder as unknown as Record<string, unknown>, 'apiUpdate', nextApiUpdate)
  }, [folder, config])

  const handleRefresh = useCallback(async () => {
    const api = getApiUpdateApi()
    if (!api || !config?.sourceUrl) return
    setPhase('fetching')
    const result = await api.refreshFetch(folderId)
    const checkedAt = Date.now()
    // Stamp `lastCheckedAt` regardless of success — a Refresh attempt
    // is itself a meaningful event ("user pinged the source at this
    // time"), separate from whether the response was usable.
    try {
      await api.setSettings(folderId, { lastCheckedAt: checkedAt })
    } catch {
      // Persistence hiccups shouldn't block the user's decision flow;
      // they'll see the up-to-date / refresh modal either way.
    }
    logger.info('[apiUpdate.refresh] checksum compare', {
      folderId,
      ok: result.ok,
      stored: config.payloadChecksum,
      fetched: result.ok ? result.checksum : null,
      match: result.ok && config.payloadChecksum === result.checksum
    })
    if (result.ok && config.payloadChecksum && result.checksum === config.payloadChecksum) {
      persistPatch({ lastCheckedAt: checkedAt })
      setPhase('up-to-date')
      return
    }
    // Self-heal: when the stored payload checksum is missing (legacy
    // project files predating the stamp, or imports that landed
    // before the renderer's commit-stamp pipeline) but the fetch was
    // OK, adopt the just-fetched checksum so the next Refresh has a
    // baseline. The user can't tell the difference — without a
    // stored baseline there's no "out of date" to surface anyway.
    if (result.ok && !config.payloadChecksum) {
      persistPatch({ lastCheckedAt: checkedAt, payloadChecksum: result.checksum })
      setPhase('up-to-date')
      return
    }
    persistPatch({ lastCheckedAt: checkedAt })
    // Mismatch or fetch error — close this modal, defer to the
    // Import modal in refresh mode (same code path the sidebar
    // context-menu entry uses).
    setPhase('idle')
    window.dispatchEvent(new CustomEvent('restorm:open-import-refresh', { detail: { folderId } }))
  }, [folderId, config, persistPatch])

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
            onClick={() => { void handleRefresh() }}
            disabled={phase !== 'idle'}
            data-testid="home-api-update-refresh"
          >
            {t('common.refresh')}
          </Button>
        </div>
      </div>

      <Modal
        isOpen={phase !== 'idle'}
        onClose={closeModal}
        title={t('folderView.home.apiUpdate.refreshing')}
        size="dialog"
        data-testid="home-api-update-refresh-modal"
      >
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {phase === 'fetching' && (
            <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <i className="codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />
              <span>{t('folderView.home.apiUpdate.fetching')}</span>
            </div>
          )}
          {phase === 'up-to-date' && (
            <>
              <p style={{ margin: 0 }} data-testid="home-api-update-up-to-date">
                {t('folderView.home.apiUpdate.upToDate')}
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button onClick={closeModal} data-testid="home-api-update-ok">
                  {t('folderView.home.apiUpdate.ok')}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  )
}
