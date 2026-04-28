import React, { useEffect, useMemo, useState } from 'react'
import { Modal, Button, Toggle, toasterService } from 'electron-core-ui/renderer'
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

type RefreshStatus = 'unchanged' | 'added' | 'modified' | 'removed' | 'previouslySkipped'

interface RefreshDiffSummary {
  byNaturalKey: Record<string, RefreshStatus>
  counts: Record<RefreshStatus, number>
  newVersion?: string
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
  refreshDiff?: (folderId: string) => Promise<unknown>
}

function getApi(): ApiUpdateApi | null {
  const api = (window as unknown as { restorm?: { apiUpdate?: ApiUpdateApi } }).restorm?.apiUpdate
  return api ?? null
}

const STATUS_PILL_STYLES: Record<RefreshStatus, { color: string; background: string; label: string }> = {
  added: { color: '#0a8f08', background: 'rgba(120, 200, 120, 0.18)', label: 'Added' },
  modified: { color: '#a36a00', background: 'rgba(255, 180, 0, 0.18)', label: 'Modified' },
  removed: { color: '#b40000', background: 'rgba(244, 67, 54, 0.18)', label: 'Removed' },
  previouslySkipped: { color: '#666', background: 'rgba(150, 150, 150, 0.18)', label: 'Skipped' },
  unchanged: { color: '#888', background: 'rgba(150, 150, 150, 0.10)', label: 'Unchanged' }
}

/**
 * Per-element refresh wizard. Shows the diff between the previously
 * imported snapshot and the freshly fetched spec, with a
 * status-aware list and a tri-state checkbox per row.
 *
 * The wizard intentionally trades depth for breadth in v1: it
 * surfaces the per-element status, the user's previous decision,
 * and a coarse include/exclude toggle. Per-field merging inside a
 * `Modified` row, the action dropdown for `Removed` rows
 * (`Mark as removed | Delete | Restore from local`), and the
 * "Show unchanged" / "Reset to defaults" toggles are explicitly
 * deferred — see the PR description for the rationale.
 *
 * The wizard funnels through the same `apply` IPC the simple
 * confirmation modal called, so the apply path is identical between
 * the two surfaces.
 */
export const RefreshWizardModal: React.FC<Props> = ({ isOpen, folderId, folderName, onApplied, onCancel }) => {
  const { t } = useTranslation()
  const [summary, setSummary] = useState<ApiUpdatePreviewSummary | null>(null)
  const [diff, setDiff] = useState<RefreshDiffSummary | null>(null)
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set())
  const [showUnchanged, setShowUnchanged] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      setSummary(null)
      setDiff(null)
      setExcluded(new Set())
      setShowUnchanged(false)
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
    if (api.refreshDiff) {
      void api.refreshDiff(folderId).then((d) => { setDiff(d as RefreshDiffSummary) }).catch(() => { /* tolerated */ })
    }
  }, [isOpen, folderId])

  const sortedRows = useMemo(() => {
    if (!diff) return []
    const rows = Object.entries(diff.byNaturalKey).map(([key, status]) => ({ key, status }))
    // Sort: added first (most attention-grabbing), then modified,
    // then removed, then previouslySkipped, then unchanged. Within a
    // bucket, alphabetical so two refreshes of the same spec produce
    // the same row order.
    const order: Record<RefreshStatus, number> = { added: 0, modified: 1, removed: 2, previouslySkipped: 3, unchanged: 4 }
    rows.sort((a, b) => {
      const cmp = order[a.status] - order[b.status]
      if (cmp !== 0) return cmp
      return a.key.localeCompare(b.key)
    })
    if (!showUnchanged) return rows.filter((r) => r.status !== 'unchanged')
    return rows
  }, [diff, showUnchanged])

  const handleRowToggle = (key: string, checked: boolean): void => {
    setExcluded((prev) => {
      const next = new Set(prev)
      if (checked) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleApply = async (): Promise<void> => {
    const api = getApi()
    if (!api) return
    setBusy(true)
    setError(null)
    try {
      await api.apply(folderId)
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

  const versionDelta = summary?.currentVersion && summary.availableVersion
    ? `${summary.currentVersion} → ${summary.availableVersion}`
    : null

  return (
    <Modal
      title={t('sidebar.apiUpdate.modalTitle', { name: folderName })}
      isOpen={isOpen}
      onClose={onCancel}
      size="dialog"
      data-testid="refresh-wizard-modal"
    >
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', minWidth: '480px' }}>
        {versionDelta && (
          <p style={{ margin: 0, fontFamily: 'monospace', opacity: 0.85 }}>{versionDelta}</p>
        )}
        {summary && (
          <p style={{ margin: 0 }}>
            {t('sidebar.apiUpdate.summary.added', { count: summary.added })}
            {' · '}{t('sidebar.apiUpdate.summary.deprecated', { count: summary.deprecated })}
            {' · '}{t('sidebar.apiUpdate.summary.removed', { count: summary.removed })}
            {' · '}{t('sidebar.apiUpdate.summary.modelsChanged', { count: summary.modelsChanged })}
          </p>
        )}
        {busy && !summary && <p style={{ margin: 0 }}>{t('sidebar.apiUpdate.checking')}</p>}
        {error && <p style={{ margin: 0, color: 'var(--errorForeground)' }}>{error}</p>}
        {sortedRows.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '320px', overflowY: 'auto' }} data-testid="refresh-wizard-rows">
            {sortedRows.map(({ key, status }) => {
              const decision = !excluded.has(key)
              const pill = STATUS_PILL_STYLES[status]
              return (
                <div
                  key={key}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px', borderRadius: '4px' }}
                  data-testid={`refresh-wizard-row-${key}`}
                >
                  <Toggle checked={decision} onChange={(next) => { handleRowToggle(key, next) }} />
                  <span style={{
                    flexGrow: 1,
                    fontFamily: 'monospace',
                    ...(status === 'removed' ? { textDecoration: 'line-through', opacity: 0.6 } : {}),
                    ...(status === 'previouslySkipped' ? { opacity: 0.6 } : {})
                  }}>{key}</span>
                  <span style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: '10px',
                    color: pill.color,
                    background: pill.background
                  }}>{pill.label}</span>
                </div>
              )
            })}
          </div>
        )}
        {diff && diff.counts.unchanged > 0 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Toggle checked={showUnchanged} onChange={setShowUnchanged} />
            <span>Show unchanged ({diff.counts.unchanged})</span>
          </label>
        )}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button secondary onClick={onCancel} disabled={busy} data-testid="refresh-wizard-cancel">
            {t('sidebar.apiUpdate.cancel')}
          </Button>
          <Button
            onClick={() => { void handleApply() }}
            disabled={busy || !summary || error !== null}
            data-testid="refresh-wizard-apply"
          >
            {busy ? t('sidebar.apiUpdate.applying') : t('sidebar.apiUpdate.apply')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default RefreshWizardModal
