/**
 * Auth IPC surface — the renderer's window onto the
 * EntitlementService. Mirrors the existing handler style (`themeHandlers.ts`):
 * `invoke` handlers for the imperative calls + a `webContents.send` broadcast
 * for the push. The renderer reads + subscribes through the preload `account`
 * namespace; raw tokens never cross the bridge (only the `AuthState` value).
 */

import { BrowserWindow, ipcMain } from 'electron'
import { AUTH_IPC, type AuthState } from '../../../shared/auth/authState'
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

/** Register `auth:login` / `auth:logout` / `auth:get-state`. Idempotent enough —
 * call once during startup. The `auth:state-changed` push is emitted by the
 * service via the injected broadcaster, not registered here. */
export function registerAuthIpc(service: EntitlementService): void {
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
}
