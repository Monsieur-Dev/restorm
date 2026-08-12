/**
 * "gRPC server (reflection)" import: unlike every other import source, there
 * is no file/URL text to paste or auto-detect — the "source" is a live
 * `host:port` connection queried via `grpc.reflection.v1alpha.ServerReflection`.
 * That doesn't fit `ImportModal`'s paste/file/URL + auto-detect flow, so it
 * gets its own small dedicated form; on success it hands the resulting
 * `EnvironmentFolder` to the same `onImport` callback `ImportModal` uses, so
 * it benefits from the same id-regeneration + tree-insertion + save path as
 * every other import.
 */

import React, { useState, useCallback, useRef } from 'react'
import {
  Modal,
  Button,
  InputBox,
  Toggle,
  KeyValueTable,
  toasterService,
  type KeyValueTableHandle,
  type KeyValueTableRow
} from 'electron-core-ui/renderer'
import { useTranslation } from 'react-i18next'
import type { FolderItem } from '../../../../shared/types/collections'
import { describeImportError, type DisplayedImportError } from './importErrorDisplay'

export interface GrpcReflectionImportModalProps {
  isOpen: boolean
  onClose: () => void
  onImport: (items: FolderItem[]) => void
}

export const GrpcReflectionImportModal: React.FC<GrpcReflectionImportModalProps> = ({ isOpen, onClose, onImport }) => {
  const { t } = useTranslation()
  const [address, setAddress] = useState('')
  const [tls, setTls] = useState(false)
  const [metadata, setMetadata] = useState<KeyValueTableRow[]>([])
  const [isLoading, setIsLoading] = useState(false)
  // Same pair the Import modal holds: a translated sentence, plus the
  // gRPC stack's own text when it produced any. `grpc-js` reports in
  // English regardless of the app's locale, so it stays in its own slot
  // rather than being folded into a localised sentence.
  const [error, setError] = useState<DisplayedImportError | null>(null)
  const metadataTableRef = useRef<KeyValueTableHandle | null>(null)

  const handleClose = useCallback(() => {
    setAddress('')
    setTls(false)
    setMetadata([])
    setError(null)
    onClose()
  }, [onClose])

  const handleImportClick = useCallback(() => {
    const trimmed = address.trim()
    if (!trimmed || isLoading) return
    setIsLoading(true)
    setError(null)
    const metadataPayload = metadata
      .filter((row) => row.enabled !== false && row.key.trim().length > 0)
      .map((row) => ({ key: row.key, value: row.value }))
    void window.restorm?.grpc.reflectImport({ address: trimmed, tls, metadata: metadataPayload })
      .then((result) => {
        if (!result.success) {
          setError(
            result.unsupported
              ? {
                  message: t('import.grpcReflection.unsupported', 'This server does not support gRPC reflection — import a .proto file instead.'),
                  detail: null
                }
              : describeImportError(t, result.error !== undefined ? { raw: result.error } : {})
          )
          return
        }
        // Idempotent re-import: this address was already imported — main
        // merged the fresh reflection result into that folder (added /
        // removed / merged operations, same `GrpcAdapter` idempotency
        // contract every other importer's refresh uses) instead of handing
        // back a folder to insert, which would have produced a duplicate.
        // Reload the project to see the merge — the current session's tree
        // doesn't live-sync from this main-side-only update.
        if (result.merged === true) {
          const d = result.diff
          const noop = !d || (d.added === 0 && d.removed === 0 && d.merged === 0 && d.deprecated === 0)
          toasterService.push('app', {
            title: t('import.grpcReflection.reimportedTitle', 'gRPC reflection re-imported'),
            body: noop
              ? t('import.grpcReflection.reimportedNoop', 'Already up to date — no changes on the server.')
              : t(
                'import.grpcReflection.reimportedSummary',
                '+{{added}} / -{{removed}} / ↻{{merged}} — reload the project to see the changes.',
                { added: d.added, removed: d.removed, merged: d.merged }
              ),
            durationMs: 10000
          })
          handleClose()
          return
        }
        if (!result.folder) {
          setError({ message: t('import.grpcReflection.unknownError', 'Unknown error'), detail: null })
          return
        }
        onImport([result.folder as FolderItem])
        handleClose()
      })
      .catch((err: unknown) => {
        setError(describeImportError(t, { raw: err instanceof Error ? err.message : String(err) }))
      })
      .finally(() => { setIsLoading(false) })
  }, [address, tls, metadata, isLoading, onImport, handleClose, t])

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t('import.grpcReflection.title', 'gRPC server (reflection)')}
      data-testid="grpc-reflection-import-modal"
      enterActionTestId="grpc-reflection-import-button"
    >
      <div className="import-modal" data-testid="grpc-reflection-import-modal-body">
        <p>
          {t(
            'import.grpcReflection.hint',
            'Query a running gRPC server\'s reflection service to discover its services and methods without a .proto file.'
          )}
        </p>
        <div className="import-section">
          <label className="import-label">{t('import.grpcReflection.addressLabel', 'Server address (host:port)')}</label>
          <InputBox
            value={address}
            onChange={setAddress}
            options={{ placeholder: t('import.grpcReflection.addressPlaceholder', 'localhost:9000') }}
            data-testid="grpc-reflection-address-input"
          />
        </div>
        <div className="import-section" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Toggle checked={tls} onChange={setTls} data-testid="grpc-reflection-tls-toggle" />
          <span>{t('import.grpcReflection.tlsLabel', 'Use TLS')}</span>
        </div>
        <div className="import-section">
          <label className="import-label">{t('import.grpcReflection.metadataLabel', 'Metadata (optional auth headers)')}</label>
          <KeyValueTable
            ref={metadataTableRef}
            data-testid="grpc-reflection-metadata-table"
            showDescription={false}
            initialRows={metadata}
            onRowsChange={setMetadata}
          />
        </div>
        {error && (
          <div className="import-error" role="alert" data-testid="grpc-reflection-import-error">
            <i className="codicon codicon-error" aria-hidden="true" />
            <div className="import-error__text">
              <span>{error.message}</span>
              {error.detail !== null && (
                <span className="import-error__detail" data-testid="grpc-reflection-import-error-detail">
                  <span className="import-error__detail-label">
                    {t('import.error.detailLabel', 'Technical detail')}
                  </span>
                  <code>{error.detail}</code>
                </span>
              )}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <Button secondary onClick={handleClose} data-testid="grpc-reflection-cancel-button">
            {t('import.cancel')}
          </Button>
          <Button
            emphasis={1}
            disabled={!address.trim() || isLoading}
            onClick={handleImportClick}
            data-testid="grpc-reflection-import-button"
          >
            {isLoading ? t('import.grpcReflection.connecting', 'Connecting…') : t('import.grpcReflection.import', 'Import')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
