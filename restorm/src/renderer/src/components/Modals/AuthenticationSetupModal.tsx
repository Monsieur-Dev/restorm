/**
 * AuthenticationSetupModal — modal wrapper around HTTPRequestTabView
 * that hosts an ephemeral AuthenticationRequest for the import flow.
 *
 * The user edits the auth request (URL / headers / body / produced
 * headers / expiration) using the standard HTTP tab view, then clicks
 * "Save & retry import". The modal fires `window.restorm.auth.prefetch`
 * — a one-shot main-process call that:
 *   1. Runs the HTTP request verbatim.
 *   2. Evaluates handlebars `producedHeaders` against the JSON body.
 *   3. Returns the resolved header map.
 * The caller (ImportModal) receives the edited request + resolved
 * headers and re-drives the import preview.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, Button } from 'electron-core-ui/renderer'
import { HTTPRequestTabView } from '../RequestTabViews/HTTPRequestTabView'
import { AuthenticationRequest } from '../../../../shared/models'
import { makeReactiveAuthenticationRequest } from '../../types/reactive'
import { EnvironmentProvider } from '../../contexts/EnvironmentContext'

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
  const [prefetchError, setPrefetchError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) {
      authRequestRef.current = null
      setPrefetchError(null)
      return
    }
    if (authRequestRef.current === null) {
      const base = initialRequest ?? makeEphemeralAuthRequest()
      // `makeReactiveAuthenticationRequest` signature expects the
      // shared-types `AuthenticationRequest` (without the class-only
      // `toPlainObject`). The class instance is structurally a
      // superset, so the cast is safe at runtime.
      authRequestRef.current = makeReactiveAuthenticationRequest(
        base as unknown as Parameters<typeof makeReactiveAuthenticationRequest>[0],
        '__import-wizard__'
      ) as AuthenticationRequest
      forceRerender((n) => n + 1)
    }
  }, [isOpen, initialRequest])

  const handleAttach = useCallback(async () => {
    const req = authRequestRef.current
    if (!req) return
    const api = window.restorm?.auth
    if (!api) {
      setPrefetchError(t('authSetupModal.ipcUnavailable', 'Authentication IPC bridge unavailable'))
      return
    }
    setPrefetchError(null)
    setIsRunning(true)
    try {
      const payload: Parameters<typeof api.prefetch>[0] = {
        method: req.method,
        url: req.url,
        headers: req.headers.map((h) => ({
          key: h.key,
          value: h.value.toString(),
          enabled: h.enabled
        })),
        producedHeaders: req.producedHeaders.map((h) => ({
          key: h.key,
          value: h.value.toString(),
          enabled: h.enabled
        })),
        ...(req.expirationExpression ? { expirationExpression: req.expirationExpression } : {}),
        ...(req.body?.type === 'text' && req.body.content
          ? { body: { type: 'text', content: req.body.content } }
          : {})
      }
      const result = await api.prefetch(payload)
      if (!result.success) {
        setPrefetchError(result.error ?? `HTTP ${result.statusCode}`)
        return
      }
      onAttach(req, result.headers)
    } catch (err) {
      setPrefetchError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsRunning(false)
    }
  }, [onAttach, t])

  const attachLabel = useMemo(
    () => isRunning
      ? t('authSetupModal.running', 'Running…')
      : t('authSetupModal.attachAndRetry', 'Save & retry import'),
    [isRunning, t]
  )

  const currentRequest = authRequestRef.current

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('authSetupModal.title', 'Add an authentication route')}
      data-testid="authentication-setup-modal"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 0 }}>
        {currentRequest ? (
          <EnvironmentProvider environments={undefined}>
            <div style={{ flex: 1, minHeight: 400, minWidth: 800, display: 'flex', flexDirection: 'column' }}>
              <HTTPRequestTabView
                request={currentRequest as unknown as Parameters<typeof HTTPRequestTabView>[0]['request']}
                disableContextSync
              />
            </div>
          </EnvironmentProvider>
        ) : null}
        {prefetchError ? (
          <div role="alert" style={{ color: 'var(--testing-iconFailed)', fontSize: 12, padding: '4px 8px' }}>
            {prefetchError}
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
