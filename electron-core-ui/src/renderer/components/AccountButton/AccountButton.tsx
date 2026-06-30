import React, { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Avatar } from '../Avatar'
import { Button } from '../Button'
import { ContextMenu, type ContextMenuItem } from '../ContextMenu/ContextMenu'
import { toasterService } from '../Toaster'
import { useAuthState } from '../../hooks/useAuthState'
import { logger } from '../../services/logger'
import './accountButton.css'

/** The value when it is a non-blank string, else `undefined` — so a blank name /
 * email falls through to the next label source rather than showing an empty
 * tooltip. */
function nonEmpty(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** Surface a subscription outcome (checkout / portal) via the app toaster. */
function toast(title: string): void {
  toasterService.push('app', { title, body: '', durationMs: 8000, ariaLive: 'assertive' })
}

/**
 * Account button for the app shell: an avatar/codicon trigger that opens a small
 * ECUI dropdown to sign in (loopback login) or sign out. The auth state is read
 * once on mount and then kept live via `useAuthState` so a login / logout from
 * anywhere repaints the button.
 *
 * Requires the host app's preload to expose `window.api.account`.
 */
export const AccountButton: React.FC = () => {
  const { t } = useTranslation()
  // Live auth state — useAuthState handles the getState() + onStateChanged subscription.
  const authState = useAuthState()
  const [menu, setMenu] = useState<{ visible: boolean; x: number; y: number }>({ visible: false, x: 0, y: 0 })
  const anchorRef = useRef<HTMLSpanElement>(null)

  const openMenu = useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect()
    if (rect) {
      // Anchor the dropdown to the button's bottom-left; ContextMenu clamps it
      // back inside the viewport if it would overflow the right edge.
      setMenu({ visible: true, x: rect.left, y: rect.bottom })
    } else {
      setMenu((prev) => ({ ...prev, visible: true }))
    }
  }, [])

  const closeMenu = useCallback(() => {
    setMenu((prev) => ({ ...prev, visible: false }))
  }, [])

  const handleSignIn = useCallback(() => {
    void window.api.account.login()
  }, [])

  const handleSignOut = useCallback(() => {
    void window.api.account.logout()
  }, [])

  // The signed-in upgrade upsell. The user is already signed in here, so this
  // goes straight to checkout; the Paddle URL opens in the system browser.
  // Checkout is org-admin-only on the backend, so a non-admin gets an actionable
  // toast rather than a silent failure.
  const handleSubscribe = useCallback(() => {
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
  }, [t])

  // Open the hosted Paddle customer portal (manage / cancel the subscription) in
  // the system browser. `no-subscription` (no billing customer) and a backend
  // error each surface an actionable toast; 'opened' hands off silently.
  const handleManageSubscription = useCallback(() => {
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
          // Unreachable: the manage item only shows when signed in. Log if it fires.
          logger.warn('account: customer-portal returned not-signed-in from the signed-in account menu')
          break
        case 'opened':
          break
      }
    })()
  }, [t])

  const { signedIn, user, plan } = authState
  // Prefer the display name, fall back to the email for both the initials and the
  // deterministic avatar colour.
  const displayName = user?.name ?? user?.email ?? ''
  // aria-label: name then email when signed in, else the sign-in CTA.
  const profileLabel = nonEmpty(user?.name) ?? nonEmpty(user?.email)
  const accountLabel = signedIn
    ? (profileLabel ?? t('account.connected'))
    : t('account.signIn')

  // A subscription affordance sits above sign-out: community users get the
  // upgrade upsell, paid (pro / enterprise) users get the manage-subscription
  // entry (the hosted Paddle portal to manage / cancel).
  const subscriptionItem: ContextMenuItem = plan === 'community'
    ? {
        id: 'account-upgrade',
        label: t('account.upgradeToPro'),
        icon: 'rocket',
        onClick: handleSubscribe,
        'data-testid': 'account-menu-upgrade'
      }
    : {
        id: 'account-manage-subscription',
        label: t('account.manageSubscription'),
        icon: 'credit-card',
        onClick: handleManageSubscription,
        'data-testid': 'account-menu-manage-subscription'
      }

  const menuItems: ContextMenuItem[] = signedIn
    ? [
        subscriptionItem,
        {
          id: 'account-sign-out',
          label: t('account.signOut'),
          icon: 'sign-out',
          onClick: handleSignOut,
          'data-testid': 'account-menu-sign-out'
        }
      ]
    : [
        {
          id: 'account-sign-in',
          label: t('account.signIn'),
          icon: 'sign-in',
          onClick: handleSignIn,
          'data-testid': 'account-menu-sign-in'
        }
      ]

  return (
    <span className="account-button-anchor" ref={anchorRef} style={{ display: 'inline-flex' }}>
      <Button
        data-testid="titlebar-account-button"
        small
        secondary
        icon={
          signedIn
            ? <Avatar name={displayName} imageUrl={user?.photoUrl} size={18} data-testid="titlebar-account-avatar" />
            : 'account'
        }
        onClick={openMenu}
        options={{ ariaLabel: accountLabel }}
      />
      <ContextMenu
        visible={menu.visible}
        x={menu.x}
        y={menu.y}
        items={menuItems}
        data-testid="account-context-menu"
        onRequestClose={closeMenu}
      />
    </span>
  )
}

export default AccountButton
