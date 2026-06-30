/**
 * Auth IPC surface — the renderer's window onto the
 * EntitlementService. Mirrors the existing handler style (`themeHandlers.ts`):
 * `invoke` handlers for the imperative calls + a `webContents.send` broadcast
 * for the push. The renderer reads + subscribes through the preload `account`
 * namespace; raw tokens never cross the bridge (only the `AuthState` value).
 */

import { BrowserWindow, ipcMain } from 'electron'
import { AUTH_IPC, type AuthState, type CheckoutResult, type PortalResult } from '../../../shared/auth/authState'
import { CheckoutHttpError } from '../entitlement/entitlementClient'
import type { EntitlementService } from '../entitlement/EntitlementService'

/** Push an auth state to every live renderer. Injected into the service as its
 * broadcaster, and reused on demand. */
export function broadcastAuthState(channel: string, state: AuthState): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, state)
    }
  }
}

/** Register `auth:login` / `auth:logout` / `auth:get-state` / `auth:checkout`.
 * Idempotent enough — call once during startup. The `auth:state-changed` push is
 * emitted by the service via the injected broadcaster, not registered here.
 * `openExternal` is injected (the composition root passes `shell.openExternal`)
 * so this module stays unit-testable without electron's `shell`. */
export function registerAuthIpc(
  service: EntitlementService,
  openExternal: (url: string) => Promise<void>
): void {
  // Login drives the browser loopback round-trip; it can take as long as the
  // user takes to authenticate (bounded by the loopback timeout). Returns the
  // resulting state so the caller can update without waiting for the broadcast.
  ipcMain.handle(AUTH_IPC.LOGIN, async () => {
    await service.signIn()
    return service.getState()
  })

  ipcMain.handle(AUTH_IPC.LOGOUT, () => {
    service.signOut()
    return service.getState()
  })

  ipcMain.handle(AUTH_IPC.GET_STATE, () => service.getState())

  // « S'abonner »: create the Paddle checkout and open it in the SYSTEM browser.
  // The raw URL never crosses the bridge — only the outcome does. 403 (the
  // backend's org-admin-only gate) is surfaced distinctly so a non-admin gets an
  // actionable message instead of a generic failure.
  ipcMain.handle(AUTH_IPC.CHECKOUT, async (): Promise<CheckoutResult> => {
    try {
      const result = await service.startCheckout()
      if (!result) return { status: 'not-signed-in' }
      if (!result.checkoutUrl) return { status: 'error' }
      await openExternal(result.checkoutUrl)
      return { status: 'opened' }
    } catch (err) {
      if (err instanceof CheckoutHttpError && err.statusCode === 403) {
        return { status: 'forbidden' }
      }
      return { status: 'error' }
    }
  })

  // « Gérer mon abonnement »: mint a hosted Paddle customer-portal session and
  // open it in the SYSTEM browser. The raw URL never crosses the bridge — only
  // the outcome does. `no-subscription` (the backend has no billing customer for
  // this account) is surfaced distinctly so the user gets an actionable message
  // rather than a silent no-op.
  ipcMain.handle(AUTH_IPC.PORTAL, async (): Promise<PortalResult> => {
    try {
      const result = await service.startCustomerPortal()
      if (!result) return { status: 'not-signed-in' }
      if (!result.portalUrl) return { status: 'no-subscription' }
      await openExternal(result.portalUrl)
      return { status: 'opened' }
    } catch {
      return { status: 'error' }
    }
  })
}
