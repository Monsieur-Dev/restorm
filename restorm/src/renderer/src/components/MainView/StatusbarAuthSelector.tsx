/**
 * StatusbarAuthSelector — key-icon cell on the statusbar that shows
 * the currently-attached authentication request for the active tab
 * and lets the user switch it via a click popover. Animates a color
 * pulse when the engine emits `auth:running` IPC events so the user
 * knows a token refresh is in flight.
 *
 * Placed to the LEFT of the env selector (per OYO-253 spec).
 * Visible only when:
 *   * The active tab is a non-auth request tab.
 *   * The active env folder contains at least one AuthenticationRequest.
 * Otherwise it renders nothing.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, StatusbarElement } from 'electron-core-ui/renderer'
import type {
  AuthenticationRequest,
  FolderItem,
  Request
} from '../../../../shared/types/collections'
import {
  isAnyFolder,
  isAuthenticationRequest,
  isRequest
} from '../../../../shared/types/collections'
import { updateReactiveProperty } from '../RequestTabViews/requestTabViewUtils'

export interface StatusbarAuthSelectorProps {
  /** The active request — the one the status bar is contextual to.
   * Updates to `authenticationRequestId` are written through this
   * reactive proxy so the save-unit / dirty pipeline fires. */
  activeRequest: Request
  /** The nearest ancestor env folder's items tree. Walked to find
   * every AuthenticationRequest available as a pick. */
  envFolderItems: readonly FolderItem[]
}

const NO_AUTH = '__none__'

function collectAuthRequests(items: readonly FolderItem[]): AuthenticationRequest[] {
  const out: AuthenticationRequest[] = []
  const walk = (nodes: readonly FolderItem[]): void => {
    for (const n of nodes) {
      if (isRequest(n) && isAuthenticationRequest(n)) out.push(n)
      if (isAnyFolder(n)) walk(n.items)
    }
  }
  walk(items)
  return out
}

export const StatusbarAuthSelector: React.FC<StatusbarAuthSelectorProps> = ({
  activeRequest,
  envFolderItems
}) => {
  const { t } = useTranslation()
  const [flash, setFlash] = useState<'idle' | 'running' | 'failed'>('idle')

  const authRequests = useMemo(() => collectAuthRequests(envFolderItems), [envFolderItems])
  const attachedId = activeRequest.authenticationRequestId ?? null
  const attached = useMemo(
    () => attachedId ? authRequests.find((r) => r.id === attachedId) ?? null : null,
    [authRequests, attachedId]
  )

  // Listen for auth:running / auth:failed broadcasts to drive the
  // flash animation. Subscribe once; filter by the attached id.
  useEffect(() => {
    const api = window.restorm?.auth
    if (!api) return
    const unsubRunning = api.onRunning((payload) => {
      if (!attachedId || payload.authRequestId !== attachedId) return
      if (payload.phase === 'started') setFlash('running')
      else if (payload.phase === 'succeeded') setFlash('idle')
      else {
        setFlash('failed')
        window.setTimeout(() => { setFlash('idle') }, 1200)
      }
    })
    const unsubFailed = api.onFailed((payload) => {
      if (!attachedId || payload.authRequestId !== attachedId) return
      setFlash('failed')
      window.setTimeout(() => { setFlash('idle') }, 1200)
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
  const backgroundColor = flash === 'running'
    ? '#f97316'
    : flash === 'failed'
      ? 'var(--testing-iconFailed)'
      : undefined

  return (
    <StatusbarElement
      data-testid="statusbar-auth-selector"
      icon={{ type: 'codicon', value: 'key' }}
      title={label}
      tooltipTrigger="click"
      {...(backgroundColor !== undefined ? { backgroundColor } : {})}
    >
      <div
        role="listbox"
        aria-label={t('statusbar.auth.popoverLabel', 'Authentication route')}
        style={{ minWidth: 240, maxWidth: 400, padding: 4, display: 'flex', flexDirection: 'column', gap: 2 }}
        data-testid="statusbar-auth-popover"
      >
        {/* Each option is an ECUI Button (consistent app-wide styling)
            wrapped in a `<div role="option">` to keep the listbox a11y
            pattern from the parent. The ECUI Button doesn't propagate
            arbitrary `role` attributes, so the wrapper carries it. */}
        <div
          role="option"
          aria-selected={attachedId === null}
          style={{
            background: attachedId === null ? 'var(--list-activeSelectionBackground)' : 'transparent',
            borderRadius: 3
          }}
        >
          <Button
            secondary
            small
            line
            data-testid="statusbar-auth-option-none"
            onClick={() => { handlePick(NO_AUTH) }}
            style={{
              width: '100%',
              justifyContent: 'flex-start',
              color: attachedId === null ? 'var(--list-activeSelectionForeground)' : undefined
            }}
          >
            {t('statusbar.auth.noAuth', 'No auth')}
          </Button>
        </div>
        {authRequests.map((req) => (
          <div
            key={req.id}
            role="option"
            aria-selected={attachedId === req.id}
            style={{
              background: attachedId === req.id ? 'var(--list-activeSelectionBackground)' : 'transparent',
              borderRadius: 3
            }}
          >
            <Button
              secondary
              small
              line
              icon="key"
              data-testid={`statusbar-auth-option-${req.id}`}
              onClick={() => { handlePick(req.id) }}
              style={{
                width: '100%',
                justifyContent: 'flex-start',
                color: attachedId === req.id ? 'var(--list-activeSelectionForeground)' : undefined
              }}
            >
              {req.name || t('statusbar.auth.unnamed', 'Unnamed')}
            </Button>
          </div>
        ))}
      </div>
    </StatusbarElement>
  )
}
