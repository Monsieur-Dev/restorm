/**
 * RequestHeaderAuthSelector — key-icon affordance in the workbench tab
 * header that reflects (and lets the user switch) the authentication
 * request attached to the active request tab.
 *
 * Visuals:
 *   * Icon-only (no text label) — just the `key` codicon.
 *   * Colour signals state: the theme's default icon foreground when no
 *     auth route is attached, the accent "attached" colour (yellow) when
 *     one is. Both update LIVE as the selection changes.
 *   * HOVER → an ECUI tooltip (via `HeaderHoverTooltip`) showing the
 *     attached route's name, or "no auth" when none. Suppressed while the
 *     click popover is open so the two overlays never stack.
 *   * CLICK → opens a popover to pick a route; picking one (or "no auth")
 *     applies it, closes the popover, and updates the key colour + tooltip
 *     immediately.
 *   * Pulses a colour ripple when the engine emits `auth:running` events
 *     so the user sees a token refresh in flight.
 *
 * Reactivity: the attached route id and the available-routes list both
 * live on the reactive document proxies. Mutations there fire eventBus
 * `REQUEST_*` events but don't, on their own, re-render this component —
 * so it subscribes to those events and re-reads the live values, instead
 * of trusting the snapshot it was rendered with. Without this, a freshly
 * attached route (or a route added to the env folder) only appeared after
 * closing and reopening the tab.
 *
 * Visible only when:
 *   * The active tab is a non-auth request tab.
 *   * The active env folder contains at least one AuthenticationRequest.
 * Otherwise it renders nothing.
 */

import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, StatusbarElement, useStatusbarTooltip, eventBus } from 'electron-core-ui/renderer'
import type {
  AuthenticationRequest,
  FolderItem,
  Request
} from '../../../../shared/types/collections'
import { DocumentEvents } from '../../services/DocumentEvents'
import { updateReactiveProperty } from '../RequestTabViews/requestTabViewUtils'
import { collectInScopeAuthRequests } from './authSelectorHelpers'
import { HeaderHoverTooltip } from './HeaderHoverTooltip'

export interface RequestHeaderAuthSelectorProps {
  /** The active request — the one the tab header is contextual to.
   * Updates to `authenticationRequestId` are written through this
   * reactive proxy so the save-unit / dirty pipeline fires. */
  activeRequest: Request
  /** The nearest ancestor env folder's items tree. Walked to find
   * every AuthenticationRequest available as a pick. */
  envFolderItems: readonly FolderItem[]
  /** Open an auth route in a workbench tab — drives the per-row
   * link-external affordance in the popover. Absent (preview contexts),
   * the link is not rendered. */
  onOpenRoute?: (requestId: string) => void
}

const NO_AUTH = '__none__'

/**
 * Re-render tick driven by document mutations. The reactive proxies emit
 * `REQUEST_UPDATED` (attach/detach a route) and `REQUEST_CREATED` /
 * `REQUEST_DELETED` (a route added to / removed from the folder); this
 * hook bumps a counter on each so the caller re-reads the live state.
 */
function useDocumentMutationTick(): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const bump = (): void => { setTick((n) => n + 1) }
    const subs = [
      eventBus.subscribe(DocumentEvents.REQUEST_UPDATED, bump),
      eventBus.subscribe(DocumentEvents.REQUEST_CREATED, bump),
      eventBus.subscribe(DocumentEvents.REQUEST_DELETED, bump)
    ]
    return () => { subs.forEach((s) => { s.unsubscribe() }) }
  }, [])
  return tick
}

/** Popover body — the route list. Lives in its own component so it can
 * read `useStatusbarTooltip().closeTooltip` and dismiss the popover after
 * a pick (the listbox a11y wrapper + ECUI Button styling mirror the env
 * picker). */
const AuthRoutePopover: React.FC<{
  authRequests: readonly AuthenticationRequest[]
  attachedId: string | null
  onPick: (id: string) => void
  onOpenRoute?: ((id: string) => void) | undefined
}> = ({ authRequests, attachedId, onPick, onOpenRoute }) => {
  const { t } = useTranslation()
  const { closeTooltip } = useStatusbarTooltip()
  const pickAndClose = useCallback((id: string): void => {
    onPick(id)
    closeTooltip()
  }, [onPick, closeTooltip])
  const openAndClose = useCallback((id: string): void => {
    onOpenRoute?.(id)
    closeTooltip()
  }, [onOpenRoute, closeTooltip])
  const openRouteLabel = t('statusbar.auth.openRoute', 'Open the authentication route')
  return (
    <div
      role="listbox"
      aria-label={t('statusbar.auth.popoverLabel', 'Authentication route')}
      style={{ minWidth: 240, maxWidth: 400, padding: 4, display: 'flex', flexDirection: 'column', gap: 2 }}
      data-testid="request-header-auth-popover"
    >
      {/* Each option is an ECUI Button (consistent app-wide styling)
          wrapped in a `<div role="option">` so the listbox a11y pattern
          survives — Button doesn't propagate arbitrary `role` attributes.
          Selection tint goes through the Button's `backgroundColor` prop
          so the active row reads as one solid shape. */}
      <div role="option" aria-selected={attachedId === null}>
        <Button
          fullWidth
          secondary
          small
          line
          align="left"
          data-testid="request-header-auth-option-none"
          onClick={() => { pickAndClose(NO_AUTH) }}
          {...(attachedId === null ? { backgroundColor: 'var(--list-activeSelectionBackground)' } : {})}
          style={{
            // `small line` zero out padding; pad the text inwards so it
            // doesn't butt up against the leading edge.
            paddingLeft: 8,
            paddingRight: 8,
            ...(attachedId === null ? { color: 'var(--list-activeSelectionForeground)' } : {})
          }}
        >
          {t('statusbar.auth.noAuth', 'No auth')}
        </Button>
      </div>
      {authRequests.map((req) => (
        <div key={req.id} role="option" aria-selected={attachedId === req.id} style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
          <Button
            fullWidth
            secondary
            small
            line
            icon="key"
            align="left"
            data-testid={`request-header-auth-option-${req.id}`}
            onClick={() => { pickAndClose(req.id) }}
            {...(attachedId === req.id ? { backgroundColor: 'var(--list-activeSelectionBackground)' } : {})}
            style={{
              paddingLeft: 8,
              paddingRight: 8,
              flex: 1,
              minWidth: 0,
              ...(attachedId === req.id ? { color: 'var(--list-activeSelectionForeground)' } : {})
            }}
          >
            {req.name || t('statusbar.auth.unnamed', 'Unnamed')}
          </Button>
          {onOpenRoute && (
            <HeaderHoverTooltip label={openRouteLabel} placement="below">
              <Button
                secondary
                small
                line
                icon="link-external"
                options={{ ariaLabel: openRouteLabel }}
                style={{ flexShrink: 0, padding: '0 4px' }}
                data-testid={`request-header-auth-open-${req.id}`}
                onClick={() => { openAndClose(req.id) }}
              />
            </HeaderHoverTooltip>
          )}
        </div>
      ))}
    </div>
  )
}

export const RequestHeaderAuthSelector: React.FC<RequestHeaderAuthSelectorProps> = ({
  activeRequest,
  envFolderItems,
  onOpenRoute
}) => {
  const { t } = useTranslation()
  // Auth events drive a ripple via ECUI's `pulseSignal` API on the
  // element. `pulseSignal` is incremented on every received event;
  // `pulseColor` flips to the failure red when the latest event was a
  // failure (and back to the default after one ripple cycle).
  const [pulseSignal, setPulseSignal] = useState(0)
  const [pulseColor, setPulseColor] = useState<string | undefined>(undefined)
  // Hover tooltip is suppressed while the click popover is open so the
  // two overlays never stack.
  const [popoverOpen, setPopoverOpen] = useState(false)
  // After the popover closes (e.g. the user just picked a route) the pointer
  // is still over the key, so the hover tooltip would pop immediately — which
  // reads as "the tooltip fires on select". Latch suppression through the
  // select→close transition and only release it once the pointer genuinely
  // leaves the key (a later re-enter is a real idle hover).
  const [suppressAfterClose, setSuppressAfterClose] = useState(false)

  const handleOpenChange = useCallback((open: boolean): void => {
    setPopoverOpen(open)
    if (!open) setSuppressAfterClose(true)
  }, [])

  // Re-render on document mutations so the live route id / route list are
  // re-read from the reactive proxies (not the render snapshot).
  // Subscribing to document mutations re-renders this component on every
  // attach / detach / route add / route delete; the values below are then
  // read fresh from the (in-place-mutated) reactive proxies. Computing the
  // route list on each render — rather than memoising it against a stable
  // `envFolderItems` reference that never changes identity when the proxy
  // mutates — is what keeps the key live; the walk is a cheap folder scan.
  useDocumentMutationTick()

  // Scope-aware: only auth routes in the request's own folder or an ancestor
  // (up to the env-folder root) — sibling-branch routes are out of scope and
  // never offered. The key hides entirely when there's no in-scope route.
  const authRequests = collectInScopeAuthRequests(envFolderItems, activeRequest.id)
  const attachedId = activeRequest.authenticationRequestId ?? null
  const attached = attachedId ? authRequests.find((r) => r.id === attachedId) ?? null : null

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

  const hasAuth = attached !== null
  const tooltipLabel = attached?.name ?? t('statusbar.auth.noAuth', 'No auth')

  return (
    <HeaderHoverTooltip
      label={tooltipLabel}
      suppressed={popoverOpen || suppressAfterClose}
      placement="below"
      data-testid="request-header-auth-tooltip"
    >
      <span
        className="request-header-auth-selector"
        data-has-auth={hasAuth ? 'true' : 'false'}
        onMouseDown={(e) => { e.stopPropagation() }}
        onMouseLeave={() => { setSuppressAfterClose(false) }}
      >
        <StatusbarElement
          data-testid="request-header-auth-selector"
          icon={{ type: 'codicon', value: 'key' }}
          tooltipTrigger="click"
          tooltipPlacement="below"
          onOpenChange={handleOpenChange}
          pulseSignal={pulseSignal}
          {...(pulseColor !== undefined ? { pulseColor } : {})}
        >
          <AuthRoutePopover
            authRequests={authRequests}
            attachedId={attachedId}
            onPick={handlePick}
            onOpenRoute={onOpenRoute}
          />
        </StatusbarElement>
      </span>
    </HeaderHoverTooltip>
  )
}
