import React, { useEffect, useState } from 'react'
import { Modal, Button, toasterService } from 'electron-core-ui/renderer'
import { useTranslation } from 'react-i18next'

interface ApiUpdatePreviewSummary {
  added: number
  deprecated: number
  removed: number
  merged: number
  modelsChanged: number
  enumsChanged: number
  currentVersion?: string
  availableVersion?: string
}

interface Props {
  isOpen: boolean
  folderId: string
  folderName: string
  onApplied: () => void
  onCancel: () => void
}

interface ApiUpdateApi {
  preview: (folderId: string) => Promise<unknown>
  apply: (folderId: string) => Promise<void>
}

function getApi(): ApiUpdateApi | null {
  const api = (window as unknown as { restorm?: { apiUpdate?: ApiUpdateApi } }).restorm?.apiUpdate
  return api ?? null
}

/**
 * "Refresh from source" confirmation dialog. On open it asks the
 * main process for a side-effect-free preview of what the apply
 * step would change (added / deprecated / removed counters), then
 * the user can commit or cancel.
 *
 * Cancel keeps the folder untouched. Apply triggers the same IPC
 * the auto-check toast's "Apply" button uses, so both code paths
 * produce identical results.
 */
export const ApiUpdateConfirmModal: React.FC<Props> = ({ isOpen, folderId, folderName, onApplied, onCancel }) => {
  const { t } = useTranslation()
  const [summary, setSummary] = useState<ApiUpdatePreviewSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      setSummary(null)
      setError(null)
      setBusy(false)
      return
    }
    const api = getApi()
    if (!api) return
    setBusy(true)
    void api.preview(folderId)
      .then((s) => { setSummary(s as ApiUpdatePreviewSummary) })
      .catch((err: unknown) => { setError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { setBusy(false) })
  }, [isOpen, folderId])

  const handleApply = async (): Promise<void> => {
    const api = getApi()
    if (!api) return
    setBusy(true)
    setError(null)
    try {
      await api.apply(folderId)
      // Surface a confirmation toast so the user knows the refresh
      // landed even though the modal closed instantly. The counters
      // come from the preview we already fetched — by definition the
      // diff the apply step ran was the same one we showed.
      if (summary) {
        toasterService.push('app', {
          title: t('sidebar.apiUpdate.successToastTitle'),
          body: t('sidebar.apiUpdate.successToastBody', {
            added: summary.added,
            deprecated: summary.deprecated,
            removed: summary.removed
          }),
          durationMs: 5_000
        })
      }
      onApplied()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('sidebar.apiUpdate.modalTitle', { name: folderName })}
      isOpen={isOpen}
      onClose={onCancel}
      size="dialog"
      data-testid="api-update-confirm-modal"
    >
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {busy && !summary && (
          <p style={{ margin: 0 }}>{t('sidebar.apiUpdate.checking')}</p>
        )}
        {error && (
          <p style={{ margin: 0, color: 'var(--errorForeground)' }}>{error}</p>
        )}
        {summary && (
          <>
            {summary.currentVersion && summary.availableVersion && (
              <p style={{ margin: 0, opacity: 0.8 }}>
                {summary.currentVersion} → {summary.availableVersion}
              </p>
            )}
            <ul style={{ margin: 0, paddingLeft: '20px' }}>
              <li>{t('sidebar.apiUpdate.summary.added', { count: summary.added })}</li>
              <li>{t('sidebar.apiUpdate.summary.deprecated', { count: summary.deprecated })}</li>
              <li>{t('sidebar.apiUpdate.summary.removed', { count: summary.removed })}</li>
              <li>{t('sidebar.apiUpdate.summary.modelsChanged', { count: summary.modelsChanged })}</li>
            </ul>
            <p style={{ margin: 0, fontSize: '12px', opacity: 0.7 }}>
              {t('sidebar.apiUpdate.preserveNote')}
            </p>
          </>
        )}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button secondary onClick={onCancel} disabled={busy} data-testid="api-update-confirm-cancel">
            {t('sidebar.apiUpdate.cancel')}
          </Button>
          <Button
            onClick={() => { void handleApply() }}
            disabled={busy || !summary || error !== null}
            data-testid="api-update-confirm-apply"
          >
            {busy ? t('sidebar.apiUpdate.applying') : t('sidebar.apiUpdate.apply')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default ApiUpdateConfirmModal
