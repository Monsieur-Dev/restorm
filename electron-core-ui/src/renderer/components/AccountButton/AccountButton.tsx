import React, { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Avatar } from '../Avatar'
import { Button } from '../Button'
import { ContextMenu, type ContextMenuItem } from '../ContextMenu/ContextMenu'
import { useAuthState } from '../../hooks/useAuthState'
import './accountButton.css'

/** The value when it is a non-blank string, else `undefined` — so a blank name /
 * email falls through to the next label source rather than showing an empty
 * tooltip. */
function nonEmpty(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
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

  const { signedIn, user } = authState
  // Prefer the display name, fall back to the email for both the initials and the
  // deterministic avatar colour.
  const displayName = user?.name ?? user?.email ?? ''
  // aria-label: name then email when signed in, else the sign-in CTA.
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
