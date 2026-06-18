/**
 * RequestHeaderAuthSelector — key-icon affordance in the workbench tab
 * header that shows the currently-attached authentication request for
 * the active request tab and lets the user switch it via a click
 * popover. Animates a colour pulse when the engine emits `auth:running`
 * IPC events so the user knows a token refresh is in flight.
 *
 * Tab-header counterpart of the (removed) statusbar auth cell — sits
 * immediately to the LEFT of the favourites star. Reuses ECUI's
 * `StatusbarElement` (click popover + codicon pulse ripple) but opens
 * its popover DOWNWARD (`tooltipPlacement="below"`), since it now lives
 * at the top of the tab rather than the bottom status bar.
 *
 * Visible only when:
 *   * The active tab is a non-auth request tab.
 *   * The active env folder contains at least one AuthenticationRequest.
 * Otherwise it renders nothing.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, StatusbarElement } from 'electron-core-ui/renderer'
import type {
  FolderItem,
  Request
} from '../../../../shared/types/collections'
import { updateReactiveProperty } from '../RequestTabViews/requestTabViewUtils'
import { collectAuthRequests } from './authSelectorHelpers'

export interface RequestHeaderAuthSelectorProps {
  /** The active request — the one the tab header is contextual to.
   * Updates to `authenticationRequestId` are written through this
   * reactive proxy so the save-unit / dirty pipeline fires. */
  activeRequest: Request
  /** The nearest ancestor env folder's items tree. Walked to find
   * every AuthenticationRequest available as a pick. */
  envFolderItems: readonly FolderItem[]
}

const NO_AUTH = '__none__'

export const RequestHeaderAuthSelector: React.FC<RequestHeaderAuthSelectorProps> = ({
  activeRequest,
  envFolderItems
}) => {
  const { t } = useTranslation()
  // Auth events drive a ripple via ECUI's `pulseSignal` API on the
  // element. `pulseSignal` is incremented on every received event;
  // `pulseColor` flips to the failure red when the latest event was a
  // failure (and back to the default after one ripple cycle).
  const [pulseSignal, setPulseSignal] = useState(0)
  const [pulseColor, setPulseColor] = useState<string | undefined>(undefined)

  const authRequests = useMemo(() => collectAuthRequests(envFolderItems), [envFolderItems])
  const attachedId = activeRequest.authenticationRequestId ?? null
  const attached = useMemo(
    () => attachedId ? authRequests.find((r) => r.id === attachedId) ?? null : null,
    [authRequests, attachedId]
  )

  useEffect(() => {
    const api = window.restorm?.auth
    if (!api) return
    const triggerPulse = (color: string | undefined): void => {
      setPulseColor(color)
      setPulseSignal((p) => p + 1)
    }
    const unsubRunning = api.onRunning((payload) => {
      if (!attachedId || payload.authRequestId !== attachedId) return
      if (payload.phase === 'started') triggerPulse(undefined)
      else if (payload.phase === 'succeeded') triggerPulse(undefined)
      else triggerPulse('var(--testing-iconFailed)')
    })
    const unsubFailed = api.onFailed((payload) => {
      if (!attachedId || payload.authRequestId !== attachedId) return
      triggerPulse('var(--testing-iconFailed)')
    })
    return () => {
      unsubRunning()
      unsubFailed()
    }
  }, [attachedId])

  const handlePick = useCallback((id: string): void => {
    if (id === NO_AUTH) {
      updateReactiveProperty(activeRequest, 'authenticationRequestId', undefined)
    } else {
      updateReactiveProperty(activeRequest, 'authenticationRequestId', id)
    }
  }, [activeRequest])

  // Hide when no auth requests are available in the folder.
  if (authRequests.length === 0) return null
  // Hide when the active request is itself an auth request.
  if (activeRequest.type === 'auth') return null

  const label = attached?.name ?? t('statusbar.auth.noAuth', 'No auth')

  return (
    <span
      className="request-header-auth-selector"
      onMouseDown={(e) => { e.stopPropagation() }}
    >
      <StatusbarElement
        data-testid="request-header-auth-selector"
        icon={{ type: 'codicon', value: 'key' }}
        title={label}
        tooltipTrigger="click"
        tooltipPlacement="below"
        pulseSignal={pulseSignal}
        {...(pulseColor !== undefined ? { pulseColor } : {})}
      >
        <div
          role="listbox"
          aria-label={t('statusbar.auth.popoverLabel', 'Authentication route')}
          style={{ minWidth: 240, maxWidth: 400, padding: 4, display: 'flex', flexDirection: 'column', gap: 2 }}
          data-testid="request-header-auth-popover"
        >
          {/* Each option is an ECUI Button (consistent app-wide styling)
              wrapped in a `<div role="option">` so the listbox a11y
              pattern survives — Button doesn't propagate arbitrary
              `role` attributes. Selection tint goes through the Button's
              `backgroundColor` prop so the active row reads as one solid
              shape rather than a wrapper-tinted halo around a flat
              button. */}
          <div role="option" aria-selected={attachedId === null}>
            <Button
              fullWidth
              secondary
              small
              line
              align="left"
              data-testid="request-header-auth-option-none"
              onClick={() => { handlePick(NO_AUTH) }}
              {...(attachedId === null ? { backgroundColor: 'var(--list-activeSelectionBackground)' } : {})}
              style={{
                // `small line` zero out padding; pad the text inwards so
                // it doesn't butt up against the leading edge.
                paddingLeft: 8,
                paddingRight: 8,
                ...(attachedId === null ? { color: 'var(--list-activeSelectionForeground)' } : {})
              }}
            >
              {t('statusbar.auth.noAuth', 'No auth')}
            </Button>
          </div>
          {authRequests.map((req) => (
            <div key={req.id} role="option" aria-selected={attachedId === req.id}>
              <Button
                fullWidth
                secondary
                small
                line
                icon="key"
                align="left"
                data-testid={`request-header-auth-option-${req.id}`}
                onClick={() => { handlePick(req.id) }}
                {...(attachedId === req.id ? { backgroundColor: 'var(--list-activeSelectionBackground)' } : {})}
                style={{
                  paddingLeft: 8,
                  paddingRight: 8,
                  ...(attachedId === req.id ? { color: 'var(--list-activeSelectionForeground)' } : {})
                }}
              >
                {req.name || t('statusbar.auth.unnamed', 'Unnamed')}
              </Button>
            </div>
          ))}
        </div>
      </StatusbarElement>
    </span>
  )
}

export default RequestHeaderAuthSelector
