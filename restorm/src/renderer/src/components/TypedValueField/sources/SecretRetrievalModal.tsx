import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, InputBox, Modal } from 'electron-core-ui/renderer'
import { SecretValue } from '../../../../../shared/types/valueTypes/SecretValue'
import './secretRetrievalModal.css'

/**
 * Retrieval-edit modal for a {@link SecretValue}.
 *
 * Opened by the pencil button beside a secret value cell. It lets the user
 * reconfigure HOW the secret is fetched (e.g. which env-var name) and VALIDATE
 * that retrieval — by explicitly fetching the value through the existing
 * `window.restorm.secrets.resolve` IPC — BEFORE committing the new config back
 * into the value.
 *
 * The modal edits a DRAFT copy of `secret.params`. Nothing mutates the live
 * value until the user presses OK; Cancel discards the draft.
 *
 * Source-extensibility: the per-source config section switches on
 * `secret.source`. Only `envVar` is handled today; other sources (env-file,
 * vaults, …) plug their own config row in the same switch later. Likewise the
 * fetched "valeur :" field is read-only for `envVar` (the env-var is owned by
 * the OS) but a writable source (e.g. an env file) would make it editable —
 * out of scope for this slice.
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

/** Clone a SecretValue with new params, preserving its (non-serialised)
 * resolved plaintext. Mirrors `cloneSecret` in SecretSourceConfig. */
function cloneSecret(value: SecretValue, params: Record<string, unknown>): SecretValue {
  const next = new SecretValue(value.source, params)
  if (value.resolved !== undefined) next.resolved = value.resolved
  return next
}

/**
 * Inner body, mounted only while the modal is open. Seeding the draft from the
 * live params happens via the `useState` initialisers (no synchronous setState
 * in an effect), and the auto-resolve effect does its setState only inside the
 * awaited callback. Cancel discards the draft simply by unmounting this body.
 */
const SecretRetrievalModalBody: React.FC<Omit<SecretRetrievalModalProps, 'isOpen'>> = ({
  secret,
  onClose,
  onChange,
  dataTestId
}) => {
  const { t } = useTranslation()

  const currentName = typeof secret.params['name'] === 'string' ? secret.params['name'] : ''

  // Draft state, local to this body. Seeded from the live params on mount (the
  // body only mounts when the modal opens), so a previous Cancel never leaks
  // into the next session — the body unmounted and remounts fresh.
  const [draftName, setDraftName] = useState(currentName)
  const [fetchedValue, setFetchedValue] = useState<string>('')
  const [fetchError, setFetchError] = useState<string | null>(null)

  // "Use the error if present, else the default". The explicit `!== undefined &&
  // !== ''` test (rather than `??` or a `x ? x : y` ternary) is deliberate: an
  // empty-string error must also fall back to the default message, which `??`
  // would not do (it only catches null/undefined).
  const resolveErrorMessage = (result: { error?: string } | undefined): string => {
    const err = result?.error
    return err !== undefined && err !== '' ? err : t('secrets.retrievalModal.fetchFailed', 'Récupération impossible')
  }

  useEffect(() => {
    // Auto-resolve on open so "valeur :" is populated immediately (normally a
    // cache hit, since the env context already resolved this secret). The Fetch
    // button is for re-fetching after the user edits the variable name.
    // `currentName` is fixed for this body's lifetime (it remounts per open), so
    // this runs once. The cancelled flag lives on a holder object (not a `let`)
    // so the post-await guard isn't narrowed to `false` — the cleanup closure
    // flips it after the await.
    const state = { cancelled: false }
    void (async () => {
      const result = await window.restorm?.secrets.resolve({ source: 'envVar', params: { name: currentName } })
      if (state.cancelled) return
      if (result && typeof result.value === 'string') {
        setFetchedValue(result.value)
        setFetchError(null)
      } else {
        const err = result?.error
        setFetchedValue('')
        setFetchError(err !== undefined && err !== '' ? err : t('secrets.retrievalModal.fetchFailed', 'Récupération impossible'))
      }
    })()
    return () => { state.cancelled = true }
  }, [currentName, t])

  const handleFetch = async (): Promise<void> => {
    setFetchError(null)
    const result = await window.restorm?.secrets.resolve({
      source: 'envVar',
      params: { name: draftName }
    })
    if (result && typeof result.value === 'string') {
      setFetchedValue(result.value)
      setFetchError(null)
    } else {
      setFetchedValue('')
      setFetchError(resolveErrorMessage(result))
    }
  }

  const handleOk = (): void => {
    // Commit the draft into the SecretValue via the same onChange the cell uses
    // to mutate the value (the document owner persists from there).
    onChange(cloneSecret(secret, { ...secret.params, name: draftName }))
    onClose()
  }

  return (
    <div className="secret-retrieval-modal-body">
        {/* Source-specific section — switch on the source; only envVar today. */}
        {secret.source === 'envVar' && (
          <div className="secret-retrieval-row">
            <label className="secret-retrieval-label" htmlFor="secret-retrieval-envvar-name">
              {t('secrets.retrievalModal.envVarName', 'Nom de la variable')}
            </label>
            <InputBox
              value={draftName}
              onChange={(next) => { setDraftName(next) }}
              options={{ type: 'text' }}
              {...(dataTestId && { 'data-testid': `${dataTestId}-retrieval-name` })}
            />
          </div>
        )}

        {/* Common section — the fetched value. Read-only for envVar; a writable
            source (env file, …) would make this editable. Out of scope here. */}
        <div className="secret-retrieval-value">
          <label className="secret-retrieval-label">
            {t('secrets.retrievalModal.value', 'valeur :')}
          </label>
          <InputBox
            value={fetchedValue}
            disabled
            options={{
              type: 'text',
              ...(fetchError && { placeholder: fetchError })
            }}
            className={fetchError ? 'secret-retrieval-input-error' : ''}
            {...(dataTestId && { 'data-testid': `${dataTestId}-retrieval-value` })}
          />
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
    >
      {isOpen && (
        <SecretRetrievalModalBody
          secret={secret}
          onClose={onClose}
          onChange={onChange}
          dataTestId={dataTestId}
        />
      )}
    </Modal>
  )
}

export default SecretRetrievalModal
