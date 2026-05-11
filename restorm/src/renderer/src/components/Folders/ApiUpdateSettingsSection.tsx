import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, InputBox, KeyValueTable, SelectBox, Toggle, type KeyValueTableHandle, type KeyValueTableRow } from 'electron-core-ui/renderer'
import type { ApiUpdateConfig, ApiUpdateInterval, ApiUpdateState } from '../../../../shared/types/baseTypes'

/**
 * Settings UX for the periodic API-update flow.
 *
 * Lives on `EnvironmentFolderHome` and is the only place the user
 * configures auto-check, interval, and source URL. Other surfaces
 * (folder badge, toaster) read the same `ApiUpdateState` snapshot
 * the IPC stream pushes — they don't have their own controls.
 */
interface Props {
  folderId: string
  config: ApiUpdateConfig | undefined
  defaultSourceUrl: string | undefined
  /** Persists a partial config patch onto the folder. The host wires
   * this to the `apiUpdate.setSettings` IPC + the local reactive
   * proxy update so the UX stays responsive while the round-trip
   * completes. */
  onSettingsChange: (patch: Partial<ApiUpdateConfig>) => void
}

const INTERVAL_ORDER: ApiUpdateInterval[] = ['hourly', 'every6h', 'daily', 'weekly', 'never']

interface ApiUpdateApi {
  getState: (folderId: string) => Promise<unknown>
  checkNow: (folderId: string) => Promise<void>
  apply: (folderId: string) => Promise<void>
  dismiss: (folderId: string) => Promise<void>
  onStateChanged: (callback: (data: { folderId: string; state: unknown }) => void) => (() => void)
}

function getApiUpdateApi(): ApiUpdateApi | null {
  const api = (window as unknown as { restorm?: { apiUpdate?: ApiUpdateApi } }).restorm?.apiUpdate
  return api ?? null
}

export const ApiUpdateSettingsSection: React.FC<Props> = ({ folderId, config, defaultSourceUrl, onSettingsChange }) => {
  const { t } = useTranslation()
  const api = getApiUpdateApi()
  const [state, setState] = useState<ApiUpdateState>({ kind: 'idle' })
  const [pendingSourceUrl, setPendingSourceUrl] = useState(config?.sourceUrl ?? defaultSourceUrl ?? '')
  const headersTableRef = useRef<KeyValueTableHandle | null>(null)

  useEffect(() => {
    if (!api) return
    let alive = true
    void api.getState(folderId).then((s) => {
      if (alive) setState(s as ApiUpdateState)
    })
    const unsubscribe = api.onStateChanged((evt) => {
      if (evt.folderId === folderId) setState(evt.state as ApiUpdateState)
    })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [api, folderId])

  const intervalOptions = useMemo(
    () => INTERVAL_ORDER.map((v) => ({ text: v, label: t(`folderView.home.apiUpdate.interval${capitalize(v)}`) })),
    [t]
  )

  const intervalSelected = useMemo(() => {
    const idx = INTERVAL_ORDER.indexOf(config?.interval ?? 'daily')
    return idx >= 0 ? idx : 2
  }, [config?.interval])

  const handleAutoCheckToggle = useCallback((checked: boolean) => {
    const seedSourceUrl = config?.sourceUrl ?? defaultSourceUrl ?? pendingSourceUrl
    if (!config && seedSourceUrl) {
      onSettingsChange({
        sourceUrl: seedSourceUrl,
        autoCheckEnabled: checked,
        interval: 'daily'
      })
      return
    }
    onSettingsChange({ autoCheckEnabled: checked })
  }, [config, defaultSourceUrl, onSettingsChange, pendingSourceUrl])

  const handleIntervalSelect = useCallback((data: { selected: string }) => {
    onSettingsChange({ interval: data.selected as ApiUpdateInterval })
  }, [onSettingsChange])

  const handleSourceUrlBlur = useCallback(() => {
    if (pendingSourceUrl !== (config?.sourceUrl ?? '')) {
      onSettingsChange({ sourceUrl: pendingSourceUrl })
    }
  }, [pendingSourceUrl, config?.sourceUrl, onSettingsChange])

  const headerEntries = Object.entries(config?.sourceHeaders ?? {})

  const handleCheckNow = useCallback(async () => {
    if (!api) return
    await api.checkNow(folderId)
  }, [api, folderId])

  const handleApply = useCallback(async () => {
    if (!api) return
    await api.apply(folderId)
  }, [api, folderId])

  const handleDismiss = useCallback(async () => {
    if (!api) return
    await api.dismiss(folderId)
  }, [api, folderId])

  if (!defaultSourceUrl && !config?.sourceUrl) {
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

  const lastCheckedLabel = config?.lastCheckedAt
    ? t('folderView.home.apiUpdate.lastCheckedAt', { time: new Date(config.lastCheckedAt).toLocaleString() })
    : t('folderView.home.apiUpdate.neverChecked')

  const stateLabel = state.kind === 'available'
    ? t('folderView.home.apiUpdate.stateAvailable')
    : state.kind === 'error'
      ? t('folderView.home.apiUpdate.stateError')
      : t('folderView.home.apiUpdate.stateIdle')

  return (
    <div className="home-section" data-testid="home-api-update-section">
      <h3 className="home-section-title">
        <span className="codicon codicon-cloud-download" />
        {t('folderView.home.apiUpdate.title')}
      </h3>
      <div className="home-section-content api-update-grid">
        <label className="api-update-toggle-row">
          <Toggle
            checked={config?.autoCheckEnabled === true}
            onChange={handleAutoCheckToggle}
            data-testid="home-api-update-auto-toggle"
          />
          <span>{t('folderView.home.apiUpdate.autoCheckLabel')}</span>
        </label>

        <label className="api-update-row">
          <span className="api-update-label">{t('folderView.home.apiUpdate.intervalLabel')}</span>
          <SelectBox
            id={`api-update-interval-${folderId}`}
            className="api-update-select"
            options={intervalOptions}
            selected={intervalSelected}
            onDidSelect={handleIntervalSelect}
            data-testid="home-api-update-interval"
          />
        </label>

        <label className="api-update-row">
          <span className="api-update-label">URL</span>
          <InputBox
            value={pendingSourceUrl}
            onChange={setPendingSourceUrl}
            onBlur={handleSourceUrlBlur}
            options={{ type: 'text', ariaLabel: 'Source URL' }}
          />
        </label>

        <div className="api-update-headers" data-testid="home-api-update-headers">
          <span className="api-update-label">Headers</span>
          {/* Same KV table the Import modal's "Add custom headers"
              uses, for visual + behavioural consistency on the
              `sourceHeaders` field. Replaces an ad-hoc renderer
              whose "Add header" button no-op'd on empty key + value
              because the underlying `handleHeaderChange` skipped
              empty keys before they could be typed in. */}
          <KeyValueTable
            ref={headersTableRef}
            data-testid="home-api-update-headers-table"
            showDescription={false}
            initialRows={headerEntries.map(([key, value]) => ({
              id: key,
              key,
              value,
              enabled: true
            }))}
            onRowsChange={(rows: KeyValueTableRow[]) => {
              const next: Record<string, string> = {}
              for (const row of rows) {
                if (!(row.enabled ?? true)) continue
                const k = row.key.trim()
                if (k.length === 0) continue
                next[k] = row.value
              }
              onSettingsChange({ sourceHeaders: next })
            }}
          />
          {/* Add-row button — the KeyValueTable renders nothing when
              `initialRows` is empty, so we surface an explicit
              "Add header" trigger that calls into the table's
              imperative handle to insert a new empty row the user
              can then fill. */}
          <Button
            icon="add"
            options={{ ariaLabel: 'Add header' }}
            data-testid="home-api-update-add-header"
            onClick={() => { headersTableRef.current?.addRow() }}
          >Add header</Button>
        </div>

        <div className="api-update-state-row" data-testid="home-api-update-state">
          <span className={`api-update-state api-update-state-${state.kind}`}>{stateLabel}</span>
          <span className="api-update-last-checked">{lastCheckedLabel}</span>
          <Button
            icon="refresh"
            options={{ ariaLabel: t('folderView.home.apiUpdate.checkNow') }}
            disabled={state.kind === 'checking'}
            onClick={() => { void handleCheckNow() }}
          >
            {state.kind === 'checking'
              ? t('folderView.home.apiUpdate.checkInProgress')
              : t('folderView.home.apiUpdate.checkNow')}
          </Button>
          {state.kind === 'available' && (
            <>
              <Button
                icon="cloud-download"
                onClick={() => { void handleApply() }}
                data-testid="home-api-update-apply"
              >
                {t('folderView.home.apiUpdate.applyUpdate')}
              </Button>
              <Button
                icon="close"
                onClick={() => { void handleDismiss() }}
                data-testid="home-api-update-dismiss"
              >
                {t('folderView.home.apiUpdate.dismiss')}
              </Button>
            </>
          )}
        </div>
        {state.error && (
          <p className="api-update-error" data-testid="home-api-update-error">{state.error}</p>
        )}
      </div>
    </div>
  )
}

function capitalize<T extends string>(s: T): Capitalize<T> {
  return (s.charAt(0).toUpperCase() + s.slice(1)) as Capitalize<T>
}
