import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Modal, logger } from 'electron-core-ui/renderer'
import { updateReactiveProperty } from '../RequestTabViews/requestTabViewUtils'
import type { ApiUpdateConfig } from '../../../../shared/types/baseTypes'
import type { EnvironmentFolder } from '../../../../shared/types/folderTypes'

/**
 * Drives the env-folder "Refresh API spec" flow end-to-end:
 *
 *   1. Mount → show a "Refreshing API spec…" modal.
 *   2. Call `apiUpdate.refreshFetch(folderId)` which fetches the
 *      source URL with the env folder's expanded headers + the
 *      resolved auth route, hashes the body, parses items.
 *   3. Stamp `lastCheckedAt` (and, on self-heal, `payloadChecksum`)
 *      on the reactive folder so the change persists.
 *   4. If the fetched checksum matches the stored one → "API spec is
 *      up to date" modal with an OK button. Done.
 *   5. Otherwise → close this modal and call `onOpenRefreshModal` so
 *      the parent can pop the Import modal in "Refresh from source"
 *      mode.
 *
 * Used by both the env-folder Home tab's Refresh button and the
 * sidebar context-menu's Refresh entry so the two paths share the
 * same UX (the previous sidebar path skipped the checksum-compare
 * modal and jumped straight to the Import wizard).
 */

interface ApiUpdateApi {
  setSettings: (folderId: string, config: Partial<ApiUpdateConfig>) => Promise<void>
  refreshFetch: (folderId: string) => Promise<{ ok: true; checksum: string; payload: string } | { ok: false; error: string }>
}

function getApiUpdateApi(): ApiUpdateApi | null {
  const api = (window as unknown as { restorm?: { apiUpdate?: ApiUpdateApi } }).restorm?.apiUpdate
  return api ?? null
}

type RefreshPhase = 'fetching' | 'up-to-date'

export interface ApiSpecRefreshFlowProps {
  /** Env folder to refresh. Read live (reactive proxy) so the
   *  stamped `lastCheckedAt` / `payloadChecksum` mutations are
   *  picked up by the same instance the rest of the UI sees. */
  folder: EnvironmentFolder
  /** Called when the user dismisses the modal (either after an
   *  "up to date" verdict, or by closing the in-flight "fetching"
   *  modal). Caller should clear the flow trigger. */
  onDismiss: () => void
  /** Called when the checksum mismatches (or fetch errored). The
   *  caller is expected to open the Import modal in refresh mode
   *  for this folder. The internal modal closes itself first. */
  onOpenRefreshModal: (folderId: string) => void
  /** Optional test-id prefix forwarded to the modal so each call
   *  site can scope its own e2e selectors. Defaults to
   *  `api-spec-refresh-flow`. */
  testIdPrefix?: string
}

export const ApiSpecRefreshFlow: React.FC<ApiSpecRefreshFlowProps> = ({
  folder,
  onDismiss,
  onOpenRefreshModal,
  testIdPrefix = 'api-spec-refresh-flow'
}) => {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<RefreshPhase>('fetching')
  // Guard against the StrictMode double-invocation firing the fetch
  // twice on mount — the second call would 401 if the auth route
  // is one-shot (cached for a single use).
  const startedRef = useRef(false)

  const folderId = folder.id
  const config = (folder as unknown as { apiUpdate?: ApiUpdateConfig }).apiUpdate

  const persistPatch = useCallback((patch: Partial<ApiUpdateConfig>) => {
    // Mutate the reactive folder proxy. `apiUpdate` lives in
    // FOLDER_INDEXABLE_KEYS, so the proxy set trap fires
    // FOLDER_UPDATED → the save-unit upsert pipeline → disk.
    const nextApiUpdate = { ...(config ?? {}), ...patch }
    updateReactiveProperty(folder as unknown as Record<string, unknown>, 'apiUpdate', nextApiUpdate)
  }, [folder, config])

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void (async () => {
      const api = getApiUpdateApi()
      if (!api || !config?.sourceUrl) {
        onDismiss()
        return
      }
      const result = await api.refreshFetch(folderId)
      const checkedAt = Date.now()
      try {
        // Mirror `lastCheckedAt` onto the main-side CollectionStore so
        // any subsequent main-side reader (e.g. an immediately-following
        // apply) sees the bump before the renderer's save-unit upsert
        // round-trips it.
        await api.setSettings(folderId, { lastCheckedAt: checkedAt })
      } catch {
        // Persistence hiccups shouldn't block the user's decision flow.
      }
      logger.info('[apiSpecRefresh] checksum compare', {
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
      if (result.ok && !config.payloadChecksum) {
        // Self-heal: a successful fetch with no stored baseline adopts
        // the fetched checksum, so legacy projects (and imports that
        // pre-date the stamp) settle on the first user-driven Refresh.
        persistPatch({ lastCheckedAt: checkedAt, payloadChecksum: result.checksum })
        setPhase('up-to-date')
        return
      }
      persistPatch({ lastCheckedAt: checkedAt })
      // Mismatch or fetch error — defer to the Import modal in
      // refresh mode. The parent handles the actual modal opening
      // (it owns the import-modal state).
      onOpenRefreshModal(folderId)
      onDismiss()
    })()
  }, [folderId, config, persistPatch, onDismiss, onOpenRefreshModal])

  return (
    <Modal
      isOpen
      onClose={onDismiss}
      title={t('folderView.home.apiUpdate.refreshing')}
      size="dialog"
      data-testid={`${testIdPrefix}-modal`}
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
            <p style={{ margin: 0 }} data-testid={`${testIdPrefix}-up-to-date`}>
              {t('folderView.home.apiUpdate.upToDate')}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button onClick={onDismiss} data-testid={`${testIdPrefix}-ok`}>
                {t('folderView.home.apiUpdate.ok')}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
