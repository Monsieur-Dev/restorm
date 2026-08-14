import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Avatar } from '../Avatar'
import { Button } from '../Button'
import { Tooltip } from '../Tooltip'
import { Modal } from '../Modal'
import { toasterService } from '../Toaster'
import { useAuthState } from '../../hooks/useAuthState'
import { useExclusivePopover } from '../../hooks/useExclusivePopover'
import { logger } from '../../services/logger'
import type { PlanTier } from '../../../shared/auth/authState'
import './accountButton.css'

/** The value when it is a non-blank string, else `undefined` — so a blank name /
 * email falls through to the next label source rather than showing an empty
 * label. */
function nonEmpty(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** Surface a subscription outcome (checkout / portal) via the app toaster. */
function toast(title: string): void {
  toasterService.push('app', { title, body: '', durationMs: 8000, ariaLive: 'assertive' })
}

/** Plan tier display labels. Proper nouns — NOT translated (kept identical
 * across locales, matching the statusbar plan cell). */
const PLAN_LABELS: Record<PlanTier, string> = {
  community: 'Community',
  pro: 'Pro',
  enterprise: 'Enterprise'
}

/** An entry the HOST application contributes to the account card.
 *
 * The card knows the shape (an icon, a label, something to run) and nothing
 * about the meaning — that is what keeps this component reusable: a host adds
 * "my API tokens", "workspace settings" or anything else without this library
 * gaining a single line about that product's concepts. */
export interface AccountCardAction {
  /** Stable identity, used as the React key and the test id suffix. */
  id: string
  /** Already-translated label. Translation belongs to the host, since the
   * string is the host's. */
  label: string
  /** Codicon name, e.g. `key`. */
  icon?: string
  /** Shown only when true (default true) — lets a host hide an entry the
   * signed-in user may not use, without unmounting the whole card. */
  visible?: boolean
  onSelect: () => void
}

export interface AccountButtonProps {
  /** The host app's customer dashboard URL (self-serve account / billing). When
   * provided, the card shows a "dashboard" link that opens it in the system
   * browser; omitted → no dashboard link (keeps the component host-agnostic). */
  dashboardUrl?: string
  /** Extra entries contributed by the host app, rendered above "sign out" and
   * only when signed in. Empty/omitted → the card is exactly as before. */
  extraActions?: readonly AccountCardAction[]
}

/**
 * Account button for the app shell: an avatar/codicon trigger that opens an ECUI
 * popover **card** with the current plan, a dashboard link, the subscription
 * action (manage / upgrade), and sign in / out. Signing out goes through a
 * confirmation dialog. The auth state is read once on mount and then kept live
 * via `useAuthState` so a login / logout from anywhere repaints the card.
 *
 * Requires the host app's preload to expose `window.api.account`.
 */
export const AccountButton: React.FC<AccountButtonProps> = ({ dashboardUrl, extraActions }) => {
  const { t } = useTranslation()
  // Live auth state — useAuthState handles the getState() + onStateChanged subscription.
  const authState = useAuthState()
  const [open, setOpen] = useState(false)
  const [confirmSignOutOpen, setConfirmSignOutOpen] = useState(false)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  const { signedIn, user, plan, role } = authState
  // Account management (dashboard, subscribe/upgrade, manage subscription) is an
  // admin-only surface. A seat-holder (member) sees only their identity, plan and
  // sign-out — the backend also enforces this, this just hides what they can't do.
  const isAdmin = signedIn && role === 'admin'

  const close = useCallback(() => { setOpen(false) }, [])
  const toggleOpen = useCallback(() => { setOpen((prev) => !prev) }, [])

  // Opening any other anchored popover closes this account card, and vice
  // versa — one popover at a time, application-wide. The outside-click
  // listener below cannot cover that: popovers guard themselves with
  // `onMouseDown` + `stopPropagation`, so a mousedown inside a sibling popover
  // never reaches this handler.
  useExclusivePopover(open, close)

  // Dismiss the card on an outside click / Escape — clicks inside the card (its
  // buttons) or on the trigger stay open. Mirrors the ECUI click-popover pattern.
  useEffect(() => {
    if (!open) return
    const onMouseDown = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (!target) return
      if (anchorRef.current?.contains(target)) return
      if (cardRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const handleSignIn = useCallback(() => {
    close()
    void window.api.account.login()
  }, [close])

  // « Se déconnecter » asks for confirmation first (a translated dialog) before
  // the real logout — sign-out is easy to hit by accident and re-login is a full
  // browser round-trip.
  const requestSignOut = useCallback(() => {
    setOpen(false)
    setConfirmSignOutOpen(true)
  }, [])

  const cancelSignOut = useCallback(() => { setConfirmSignOutOpen(false) }, [])

  const confirmSignOut = useCallback(() => {
    setConfirmSignOutOpen(false)
    void window.api.account.logout()
  }, [])

  // « Passer à Pro » upsell. Shown only to a signed-in community user, so it goes
  // straight to checkout. Checkout is org-admin-only on the backend → a non-admin
  // gets an actionable toast. The Paddle URL opens in the system browser.
  const handleSubscribe = useCallback(() => {
    close()
    void (async (): Promise<void> => {
      const result = await window.api.account.subscribe()
      switch (result.status) {
        case 'forbidden':
          toast(t('subscription.checkout.forbidden'))
          break
        case 'error':
          toast(t('subscription.checkout.error'))
          break
        case 'not-signed-in':
          // Unreachable: the upsell only shows when signed in. Log if it fires.
          logger.warn('account: checkout returned not-signed-in from the signed-in upsell')
          break
        case 'opened':
          break
      }
    })()
  }, [close, t])

  // Open the hosted Paddle customer portal (manage / cancel the subscription) in
  // the system browser. `no-subscription` (no billing customer) and a backend
  // error each surface an actionable toast; 'opened' hands off silently.
  const handleManageSubscription = useCallback(() => {
    close()
    void (async (): Promise<void> => {
      const result = await window.api.account.manageSubscription()
      switch (result.status) {
        case 'no-subscription':
          toast(t('subscription.portal.noSubscription'))
          break
        case 'error':
          toast(t('subscription.portal.error'))
          break
        case 'not-signed-in':
          // Unreachable: the manage entry only shows when signed in. Log if it fires.
          logger.warn('account: customer-portal returned not-signed-in from the signed-in card')
          break
        case 'opened':
          break
      }
    })()
  }, [close, t])

  // Open the host dashboard in the system browser (main routes http(s)
  // window.open through shell.openExternal).
  const handleDashboard = useCallback(() => {
    if (!dashboardUrl) return
    close()
    window.open(dashboardUrl, '_blank', 'noopener,noreferrer')
  }, [close, dashboardUrl])

  // Prefer the display name, fall back to the email for both the initials and the
  // deterministic avatar colour.
  const displayName = user?.name ?? user?.email ?? ''
  const profileLabel = nonEmpty(user?.name) ?? nonEmpty(user?.email)
  const accountLabel = signedIn
    ? (profileLabel ?? t('account.connected'))
    : t('account.signIn')

  // Signed out → a minimal card with just the sign-in action (the plan badge and
  // upsell belong to the signed-in states). Signed in → the full account card.
  const card = signedIn
    ? (
      <div className="account-card" ref={cardRef} data-testid="account-card">
        <div className="account-card-header">
          <Avatar name={displayName} imageUrl={user?.photoUrl} size={28} data-testid="account-card-avatar" />
          <div className="account-card-identity">
            <span className="account-card-name" data-testid="account-card-name">
              {profileLabel ?? t('account.connected')}
            </span>
            <span
              className={`account-plan-badge account-plan-badge--${plan}`}
              data-testid="account-card-plan-badge"
            >
              {PLAN_LABELS[plan]}
            </span>
          </div>
        </div>

        <div className="account-card-actions">
          {isAdmin && dashboardUrl !== undefined && (
            <Button
              link
              icon="dashboard"
              onClick={handleDashboard}
              data-testid="account-card-dashboard"
            >
              {t('account.dashboard')}
            </Button>
          )}

          {isAdmin && (plan === 'community'
            ? (
              <Button
                link
                icon="rocket"
                onClick={handleSubscribe}
                data-testid="account-card-upgrade"
              >
                {t('account.upgradeToPro')}
              </Button>
            )
            : (
              <Button
                link
                icon="credit-card"
                onClick={handleManageSubscription}
                data-testid="account-card-manage-subscription"
              >
                {t('account.manageSubscription')}
              </Button>
            ))}

          {(extraActions ?? [])
            .filter((a) => a.visible !== false)
            .map((a) => (
              <Button
                key={a.id}
                link
                {...(a.icon === undefined ? {} : { icon: a.icon })}
                onClick={() => {
                  setOpen(false)
                  a.onSelect()
                }}
                data-testid={`account-card-${a.id}`}
              >
                {a.label}
              </Button>
            ))}

          <Button
            link
            icon="sign-out"
            onClick={requestSignOut}
            data-testid="account-card-sign-out"
          >
            {t('account.signOut')}
          </Button>
        </div>
      </div>
    )
    : (
      <div className="account-card account-card--signed-out" ref={cardRef} data-testid="account-card">
        <Button
          link
          icon="sign-in"
          onClick={handleSignIn}
          data-testid="account-card-sign-in"
        >
          {t('account.signIn')}
        </Button>
      </div>
    )

  return (
    <span className="account-button-anchor" ref={anchorRef} style={{ display: 'inline-flex' }}>
      <Button
        data-testid="titlebar-account-button"
        small
        secondary
        aria-haspopup="dialog"
        aria-expanded={open}
        icon={
          signedIn
            ? <Avatar name={displayName} imageUrl={user?.photoUrl} size={18} data-testid="titlebar-account-avatar" />
            : 'account'
        }
        onClick={toggleOpen}
        options={{ ariaLabel: accountLabel }}
      />
      <Tooltip
        targetRef={anchorRef}
        placement="below"
        content={card}
        show={open}
        className="account-card-tooltip"
        data-testid="account-card-popover"
      />
      <Modal
        title={t('account.signOut')}
        isOpen={confirmSignOutOpen}
        onClose={cancelSignOut}
        size="dialog"
        data-testid="account-sign-out-confirm"
      >
        <div className="account-sign-out-confirm">
          <p className="account-sign-out-confirm-message" data-testid="account-sign-out-confirm-message">
            {t('account.signOutConfirm.message')}
          </p>
          <div className="account-sign-out-confirm-actions">
            <Button
              secondary
              onClick={cancelSignOut}
              data-testid="account-sign-out-confirm-cancel"
            >
              {t('account.signOutConfirm.cancel')}
            </Button>
            <Button
              onClick={confirmSignOut}
              data-testid="account-sign-out-confirm-yes"
            >
              {t('account.signOutConfirm.confirm')}
            </Button>
          </div>
        </div>
      </Modal>
    </span>
  )
}
