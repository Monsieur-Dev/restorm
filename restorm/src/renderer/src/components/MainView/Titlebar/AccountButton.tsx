import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Avatar, Button, ContextMenu, type ContextMenuItem } from 'electron-core-ui/renderer'
import type { AuthState } from '../../../../../shared/auth/authState'
import { HeaderHoverTooltip } from '../HeaderHoverTooltip'
import './AccountButton.css'

/** The signed-out baseline used until the first `getState()` resolves, so the
 * button paints the account codicon immediately on mount. */
const SIGNED_OUT: AuthState = { signedIn: false, user: null, plan: 'community', capabilities: [] }

/** The value when it is a non-blank string, else `undefined` — so a blank name /
 * email falls through to the next label source rather than showing an empty
 * tooltip. */
function nonEmpty(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/**
 * Account button for the titlebar: an avatar/codicon trigger that opens a small
 * ECUI dropdown to sign in (loopback login) or sign out. The auth state is read
 * once on mount and then kept live via `account.onStateChanged` so a login /
 * logout from anywhere (this window or another instance) repaints the button.
 */
export const AccountButton: React.FC = () => {
  const { t } = useTranslation()
  const [authState, setAuthState] = useState<AuthState>(SIGNED_OUT)
  const [menu, setMenu] = useState<{ visible: boolean; x: number; y: number }>({ visible: false, x: 0, y: 0 })
  const anchorRef = useRef<HTMLSpanElement>(null)

  // Seed the initial state and subscribe to live transitions. The subscription
  // returns an unsubscribe fn we detach on unmount.
  useEffect(() => {
    let active = true
    void window.api.account.getState().then((state) => {
      if (active) setAuthState(state)
    })
    const unsubscribe = window.api.account.onStateChanged((state) => {
      setAuthState(state)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

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

  const { signedIn, user } = authState
  // Prefer the display name, fall back to the email (always present when signed
  // in) for both the initials and the deterministic avatar colour.
  const displayName = user?.name ?? user?.email ?? ''
  // Tooltip + aria-label identify the account: when signed IN, the name, then the
  // email, else « Connecté » (no profile name/email). When signed OUT, the
  // « Se connecter » call to action (reusing the menu item's key).
  const profileLabel = nonEmpty(user?.name) ?? nonEmpty(user?.email)
  const accountLabel = signedIn
    ? (profileLabel ?? t('account.connected'))
    : t('account.signIn')

  const menuItems: ContextMenuItem[] = signedIn
    ? [
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
    <HeaderHoverTooltip label={accountLabel} suppressed={menu.visible} className="account-button-anchor">
      <span ref={anchorRef} style={{ display: 'inline-flex' }}>
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
      </span>
      <ContextMenu
        visible={menu.visible}
        x={menu.x}
        y={menu.y}
        items={menuItems}
        data-testid="account-context-menu"
        onRequestClose={closeMenu}
      />
    </HeaderHoverTooltip>
  )
}

export default AccountButton
