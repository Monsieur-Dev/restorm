/**
 * AuthenticationSetupModal — modal wrapper around
 * LocalAuthenticationRequestForm that hosts an ephemeral
 * AuthenticationRequest for the import flow.
 *
 * The request is a plain class instance (not a reactive proxy) —
 * it has no collection yet, no variables to resolve, and no need
 * for ContextService wiring, so every keystroke stays entirely
 * local (zero IPC traffic, zero renderer-side broadcasts). The
 * form mutates the instance in place; this modal reads the final
 * state when the user clicks "Save & retry import".
 *
 * Save & retry import:
 *   1. Serialize the current request to the one-shot prefetch
 *      payload (shared with the form's inline Send button).
 *   2. Fire `window.restorm.auth.prefetch` — runs the HTTP call,
 *      evaluates handlebars `producedHeaders` against the response
 *      body, and returns the resolved header map.
 *   3. Forward the request + resolved headers to the caller so
 *      ImportModal can re-drive the import preview.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, Button } from 'electron-core-ui/renderer'
import { LocalAuthenticationRequestForm } from '../RequestTabViews/LocalAuthenticationRequestForm'
import { AuthenticationRequest } from '../../../../shared/models'
import { buildAuthPrefetchPayload } from './authPrefetchPayload'

export interface AuthenticationSetupModalProps {
  isOpen: boolean
  onClose: () => void
  /** Callback invoked when the user clicks "Save & retry". Receives
   * the edited auth request (still ephemeral — the caller is
   * responsible for persisting it on final import) and the resolved
   * headers ready to re-drive the import fetch. */
  onAttach: (authRequest: AuthenticationRequest, resolvedHeaders: Record<string, string>) => void
  /** Optional initial auth request (used when re-opening the modal
   * to edit an already-configured route). */
  initialRequest?: AuthenticationRequest | undefined
}

function makeEphemeralAuthRequest(): AuthenticationRequest {
  return AuthenticationRequest.fromPlain({
    id: crypto.randomUUID(),
    name: 'Authentication route',
    method: 'POST',
    url: ''
  })
}

export const AuthenticationSetupModal: React.FC<AuthenticationSetupModalProps> = ({
  isOpen,
  onClose,
  onAttach,
  initialRequest
}) => {
  const { t } = useTranslation()
  const authRequestRef = useRef<AuthenticationRequest | null>(null)
  const [, forceRerender] = useState(0)
  const [isRunning, setIsRunning] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      authRequestRef.current = null
      return
    }
    if (authRequestRef.current === null) {
      // Plain class instance, no reactive proxy. The form mutates
      // this in place; we read the final state on Save & retry.
      authRequestRef.current = initialRequest ?? makeEphemeralAuthRequest()
      forceRerender((n) => n + 1)
    }
  }, [isOpen, initialRequest])

  const handleAttach = useCallback(async () => {
    const req = authRequestRef.current
    if (!req) return
    const api = window.restorm?.auth
    if (!api) return
    setIsRunning(true)
    try {
      const result = await api.prefetch(
        buildAuthPrefetchPayload(req as unknown as Parameters<typeof buildAuthPrefetchPayload>[0])
      )
      if (!result.success) return
      onAttach(req, result.headers)
    } catch {
      // Failures are surfaced in the embedded form's Response tab
      // via its own Send call; the Save & retry path stays silent.
    } finally {
      setIsRunning(false)
    }
  }, [onAttach])

  const attachLabel = useMemo(
    () => isRunning
      ? t('authSetupModal.running', 'Running…')
      : t('authSetupModal.attachAndRetry', 'OK'),
    [isRunning, t]
  )

  const currentRequest = authRequestRef.current

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('authSetupModal.title', 'Add an authentication route')}
      data-testid="authentication-setup-modal"
      enterActionTestId="authentication-setup-attach"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 0 }}>
        {currentRequest ? (
          // `minHeight` was pushing the footer below the modal frame
          // when the window was shorter than 400px of content area.
          // The form handles its own overflow via internal
          // ScrollableElements, so let it shrink freely.
          <div style={{ flex: 1, minWidth: 800, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <LocalAuthenticationRequestForm
              request={currentRequest as unknown as Parameters<typeof LocalAuthenticationRequestForm>[0]['request']}
            />
          </div>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid var(--panel-border)' }}>
          <Button
            onClick={onClose}
            options={{
              ariaLabel: t('authSetupModal.cancel', 'Cancel'),
              title: t('authSetupModal.cancel', 'Cancel')
            }}
            data-testid="authentication-setup-cancel"
          >
            {t('authSetupModal.cancel', 'Cancel')}
          </Button>
          <Button
            emphasis={1}
            disabled={isRunning}
            onClick={() => { void handleAttach() }}
            options={{
              ariaLabel: attachLabel,
              title: attachLabel
            }}
            data-testid="authentication-setup-attach"
          >
            {attachLabel}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
