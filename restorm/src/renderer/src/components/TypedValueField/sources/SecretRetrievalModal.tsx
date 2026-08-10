import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Modal } from 'electron-core-ui/renderer'
import { SecretValue } from '../../../../../shared/types/valueTypes/SecretValue'
import { SecretSourceConfig } from './SecretSourceConfig'
import './secretRetrievalModal.css'

/**
 * Retrieval-edit modal for a {@link SecretValue}, opened by the pencil button on
 * the secret cell. It is the SINGLE place where a secret is configured — the
 * cell itself only previews the resolved value. The modal lets the user:
 *   1. reconfigure HOW the secret is fetched, via the per-source editing surface
 *      ({@link SecretSourceConfig} — an env-var name, a fake value, an env-file
 *      write-field, …), and
 *   2. VALIDATE that retrieval by explicitly fetching the value through the
 *      `window.restorm.secrets.resolve` IPC, BEFORE committing the new config.
 *
 * The modal edits a DRAFT copy of the secret. Nothing mutates the live value
 * until the user presses OK; Cancel discards the draft (the body unmounts).
 *
 * Source-extensibility: the config surface is registry-driven, so a new source
 * needs no change here — it plugs its `paramSchema` / `configComponent` and the
 * modal renders it.
 */
export interface SecretRetrievalModalProps {
  /** The secret whose retrieval is being edited. */
  secret: SecretValue
  isOpen: boolean
  onClose: () => void
  /** Commit the edited secret back into the document (same path the cell uses). */
  onChange: (next: SecretValue) => void
  dataTestId?: string | undefined
}

/**
 * Inner body, mounted only while the modal is open. The draft seeds from the
 * live secret via the `useState` initialiser (no synchronous setState in an
 * effect), and the auto-resolve effect does its setState only inside the awaited
 * callback. Cancel discards the draft simply by unmounting this body.
 */
const SecretRetrievalModalBody: React.FC<Omit<SecretRetrievalModalProps, 'isOpen'>> = ({
  secret,
  onClose,
  onChange,
  dataTestId
}) => {
  const { t } = useTranslation()

  // Draft state, local to this body. Seeded from the live secret on mount (the
  // body only mounts when the modal opens), so a previous Cancel never leaks
  // into the next session — the body unmounted and remounts fresh.
  const [draft, setDraft] = useState<SecretValue>(() => {
    const seed = new SecretValue(secret.source, { ...secret.params })
    if (secret.resolved !== undefined) seed.resolved = secret.resolved
    return seed
  })
  const [fetchedValue, setFetchedValue] = useState<string>('')
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [isFetching, setIsFetching] = useState(false)

  // "Use the error if present, else the default". The explicit `!== undefined &&
  // !== ''` test (rather than `??` or a `x ? x : y` ternary) is deliberate: an
  // empty-string error must also fall back to the default message, which `??`
  // would not do (it only catches null/undefined).
  const resolveErrorMessage = (result: { error?: string } | undefined): string => {
    const err = result?.error
    return err !== undefined && err !== '' ? err : t('secrets.retrievalModal.fetchFailed', 'Récupération impossible')
  }

  // `source`/`params` are fixed for this body's lifetime (it remounts per open),
  // so the auto-resolve runs once. The cancelled flag lives on a holder object
  // (not a `let`) so the post-await guard isn't narrowed to `false`.
  const initialSource = secret.source
  const initialParams = secret.params
  useEffect(() => {
    const state = { cancelled: false }
    void (async () => {
      const result = await window.restorm?.secrets.resolve({ source: initialSource, params: initialParams })
      if (state.cancelled) return
      if (result && typeof result.value === 'string') {
        setFetchedValue(result.value)
        setFetchError(null)
      } else {
        // Inline (not via resolveErrorMessage) to keep the effect's deps honest.
        const err = result?.error
        setFetchedValue('')
        setFetchError(err !== undefined && err !== '' ? err : t('secrets.retrievalModal.fetchFailed', 'Récupération impossible'))
      }
    })()
    return () => { state.cancelled = true }
  }, [initialSource, initialParams, t])

  const handleFetch = async (): Promise<void> => {
    setFetchError(null)
    setIsFetching(true)
    const result = await window.restorm?.secrets.resolve({ source: draft.source, params: draft.params })
    setIsFetching(false)
    if (result && typeof result.value === 'string') {
      setFetchedValue(result.value)
      setFetchError(null)
    } else {
      setFetchedValue('')
      setFetchError(resolveErrorMessage(result))
    }
  }

  const handleOk = (): void => {
    // Commit the draft into the document via the same onChange the cell uses.
    onChange(draft)
    onClose()
  }

  return (
    <div className="secret-retrieval-modal-body">
      {/* Per-source editing surface — registry-driven, one row per source. */}
      <div className="secret-retrieval-row">
        <SecretSourceConfig
          value={draft}
          onChange={setDraft}
          {...(dataTestId && { dataTestId })}
        />
      </div>

      {/* Common section — the fetched value, read-only (it is the resolution
          result, shown so the user can confirm retrieval works). A selectable
          WRAPPING label, not a disabled input: the user reads and copies it,
          never edits it, and a long value must fold instead of scrolling. */}
      <div className="secret-retrieval-value">
        <label className="secret-retrieval-label">
          {t('secrets.retrievalModal.value', 'valeur :')}
        </label>
        <span
          className={`secret-retrieval-value-text${fetchError ? ' secret-retrieval-input-error' : ''}`}
          {...(dataTestId && { 'data-testid': `${dataTestId}-retrieval-value` })}
        >
          {fetchedValue}
        </span>
        {fetchError && (
          <span
            className="secret-retrieval-error"
            {...(dataTestId && { 'data-testid': `${dataTestId}-retrieval-error` })}
          >
            {fetchError}
          </span>
        )}
      </div>

      {/* Footer: Fetch bottom-left, Cancel + OK bottom-right. */}
      <div className="secret-retrieval-footer">
        <Button
          secondary
          disabled={isFetching}
          onClick={() => { void handleFetch() }}
          {...(dataTestId && { 'data-testid': `${dataTestId}-retrieval-fetch` })}
        >
          {t('secrets.retrievalModal.fetch', 'Récupérer')}
        </Button>
        <div className="secret-retrieval-footer-right">
          <Button
            secondary
            onClick={onClose}
            {...(dataTestId && { 'data-testid': `${dataTestId}-retrieval-cancel` })}
          >
            {t('secrets.retrievalModal.cancel', 'Annuler')}
          </Button>
          <Button
            onClick={handleOk}
            {...(dataTestId && { 'data-testid': `${dataTestId}-retrieval-ok` })}
          >
            {t('secrets.retrievalModal.ok', 'OK')}
          </Button>
        </div>
      </div>
    </div>
  )
}

export const SecretRetrievalModal: React.FC<SecretRetrievalModalProps> = ({
  secret,
  isOpen,
  onClose,
  onChange,
  dataTestId
}) => {
  const { t } = useTranslation()

  // The Modal shell is always rendered (it owns the open/close animation), but
  // the body only mounts while `isOpen`. Mounting on open lets the body seed its
  // draft state via `useState` initialisers instead of a synchronous setState in
  // an effect, and unmounting on close discards the draft (the Cancel contract).
  return (
    <Modal
      title={t('secrets.retrievalModal.title', 'Récupération du secret')}
      isOpen={isOpen}
      onClose={onClose}
      size="dialog"
      scopeToSelector=".restorm-workbench-tab"
      data-testid={dataTestId ? `${dataTestId}-retrieval-modal` : 'secret-retrieval-modal'}
      {...(dataTestId ? { enterActionTestId: `${dataTestId}-retrieval-ok` } : {})}
    >
      {isOpen && (
        <SecretRetrievalModalBody
          secret={secret}
          onClose={onClose}
          onChange={onChange}
          {...(dataTestId && { dataTestId })}
        />
      )}
    </Modal>
  )
}

export default SecretRetrievalModal
