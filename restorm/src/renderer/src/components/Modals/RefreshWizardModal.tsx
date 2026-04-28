import React, { useEffect, useMemo, useState } from 'react'
import { Modal, Button, Toggle, toasterService } from 'electron-core-ui/renderer'
import { useTranslation } from 'react-i18next'
import { ImportSelectionTree, type RefreshLeafStatus } from './ImportSelectionTree'
import {
  importNaturalKeyForRequest,
  walkImportTreeWithKeys
} from '../../../../shared/utils/importNaturalKey'
import { isAnyFolder, isRequest } from '../../../../shared/types/folderTypes'
import type { FolderItem } from '../../../../shared/types/folderTypes'

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
  previewTree?: FolderItem[]
  byImportSelectionKey?: Record<string, RefreshStatus>
}

interface Props {
  isOpen: boolean
  folderId: string
  folderName: string
  /** Called with the post-apply payload from main so the caller can
   * splice the new requests onto its own copy of the env folder. */
  onApplied: (updatedFolder: unknown) => void
  onCancel: () => void
}

interface ApiUpdateApi {
  preview: (folderId: string) => Promise<unknown>
  apply: (folderId: string, selection?: { include: string[]; skip: string[] }) => Promise<{ updatedFolder: unknown }>
  refreshDiff?: (folderId: string) => Promise<unknown>
}

function getApi(): ApiUpdateApi | null {
  const api = (window as unknown as { restorm?: { apiUpdate?: ApiUpdateApi } }).restorm?.apiUpdate
  return api ?? null
}

/**
 * Refresh-from-source wizard. Reuses the OYO-257
 * `ImportSelectionTree` so the visual surface (folders, method
 * badges, tri-state checkbox cascade, search filter) stays identical
 * with the import dialog. Per-element status pills (Added /
 * Modified / Removed / Skipped / Unchanged) ride alongside the
 * checkboxes via the new `leafStatusByKey` prop on the tree.
 *
 * On Apply: every leaf the user has checked goes into the
 * `include` payload (in OYO-257 keys), the rest into `skip`. Main
 * translates back to pipeline keys before filtering the spec.
 */
export const RefreshWizardModal: React.FC<Props> = ({ isOpen, folderId, folderName, onApplied, onCancel }) => {
  const { t } = useTranslation()
  const [summary, setSummary] = useState<ApiUpdatePreviewSummary | null>(null)
  const [diff, setDiff] = useState<RefreshDiffSummary | null>(null)
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set())
  const [searchFilter, setSearchFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      setSummary(null)
      setDiff(null)
      setSelection(new Set())
      setSearchFilter('')
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
      void api.refreshDiff(folderId)
        .then((d) => {
          const next = d as RefreshDiffSummary
          setDiff(next)
          // Default selection: every leaf whose default decision is
          // "include" (added / modified / unchanged). The user can
          // tick `previouslySkipped` rows on or untick `unchanged`
          // ones — Apply only acts on the resolved set.
          if (next.previewTree && next.byImportSelectionKey) {
            const initial = new Set<string>()
            for (const entry of walkImportTreeWithKeys(next.previewTree)) {
              if ('items' in entry.item) continue
              const status = next.byImportSelectionKey[entry.key]
              if (status === 'added' || status === 'modified' || status === 'unchanged' || status === undefined) {
                initial.add(entry.key)
              }
            }
            setSelection(initial)
          }
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : String(err))
        })
    }
  }, [isOpen, folderId])

  const leafStatusByKey = useMemo(() => {
    if (!diff?.byImportSelectionKey) return undefined
    const map = new Map<string, RefreshLeafStatus>()
    for (const [key, status] of Object.entries(diff.byImportSelectionKey)) map.set(key, status)
    return map
  }, [diff])

  const handleApply = async (): Promise<void> => {
    const api = getApi()
    if (!api) return
    setBusy(true)
    setError(null)
    try {
      let result: { updatedFolder: unknown }
      if (diff?.previewTree) {
        const include: string[] = []
        const skip: string[] = []
        // Walk the preview tree to build the include / skip lists from
        // the user's resolved selection. Sending OYO-257 keys; main
        // translates back to pipeline keys before filtering the spec.
        const walk = (nodes: FolderItem[]): void => {
          for (const node of nodes) {
            if (isAnyFolder(node)) {
              walk(node.items)
              continue
            }
            if (!isRequest(node)) continue
            const key = importNaturalKeyForRequest(node)
            if (selection.has(key)) include.push(key)
            else skip.push(key)
          }
        }
        walk(diff.previewTree)
        result = await api.apply(folderId, { include, skip })
      } else {
        // Fallback: no tree available (older diff payload). Apply
        // everything the spec describes.
        result = await api.apply(folderId)
      }
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
      onApplied(result.updatedFolder)
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
      size="full"
      data-testid="refresh-wizard-modal"
    >
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', minWidth: '600px', maxHeight: '70vh' }}>
        {versionDelta && (
          <p style={{ margin: 0, fontFamily: 'monospace', opacity: 0.85 }}>{versionDelta}</p>
        )}
        {diff && (() => {
          // Restrict the summary to operations (the rows the user
          // actually sees in the tree). Model / enum keys
          // (`model:Pet`, `enum:Status`) flow through the diff
          // resolver too but aren't shown anywhere actionable —
          // counting them under "added" would surface as a
          // mysterious +1 on every refresh. They get a separate
          // "X model(s) changed" counter.
          //
          // The two diff maps overlap: byImportSelectionKey carries
          // the OYO-257 keyspace (one entry per spec op for
          // swagger/openapi), byNaturalKey carries the pipeline
          // keyspace (always populated). We pick byImportSelectionKey
          // when it exists, else byNaturalKey, so each op is counted
          // exactly once.
          const counts: Record<RefreshStatus, number> = {
            added: 0, modified: 0, removed: 0, previouslySkipped: 0, unchanged: 0
          }
          let modelsTouched = 0
          const source = diff.byImportSelectionKey ?? diff.byNaturalKey
          for (const [key, status] of Object.entries(source)) {
            if (key.startsWith('model:') || key.startsWith('enum:')) {
              if (status !== 'unchanged') modelsTouched++
              continue
            }
            counts[status] += 1
          }
          return (
            <p style={{ margin: 0 }} data-testid="refresh-wizard-summary">
              {t('sidebar.apiUpdate.summary.added', { count: counts.added })}
              {' · '}{t('sidebar.apiUpdate.summary.modified', { count: counts.modified })}
              {' · '}{t('sidebar.apiUpdate.summary.removed', { count: counts.removed })}
              {' · '}{t('sidebar.apiUpdate.summary.skipped', { count: counts.previouslySkipped })}
              {' · '}{t('sidebar.apiUpdate.summary.unchanged', { count: counts.unchanged })}
              {modelsTouched > 0 && (
                <> · {t('sidebar.apiUpdate.summary.modelsChanged', { count: modelsTouched })}</>
              )}
            </p>
          )
        })()}
        {busy && !summary && <p style={{ margin: 0 }}>{t('sidebar.apiUpdate.checking')}</p>}
        {error && <p style={{ margin: 0, color: 'var(--errorForeground)' }}>{error}</p>}
        {diff?.previewTree && (
          <>
            <input
              type="text"
              placeholder="Filter routes / folders…"
              value={searchFilter}
              onChange={(e) => { setSearchFilter(e.target.value) }}
              style={{
                padding: '6px 10px',
                borderRadius: '4px',
                border: '1px solid var(--input-border, #555)',
                background: 'var(--input-background, #1e1e1e)',
                color: 'var(--input-foreground, #ddd)'
              }}
              data-testid="refresh-wizard-search"
            />
            <div style={{ flex: 1, overflowY: 'auto', minHeight: '320px' }}>
              <ImportSelectionTree
                items={diff.previewTree}
                selection={selection}
                onSelectionChange={setSelection}
                searchFilter={searchFilter}
                {...(leafStatusByKey ? { leafStatusByKey } : {})}
                data-testid="refresh-wizard-tree"
              />
            </div>
          </>
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

// Suppress unused-warning: Toggle isn't used directly by the modal
// but is re-exported here for tests that drill into older surfaces.
void Toggle

export default RefreshWizardModal
