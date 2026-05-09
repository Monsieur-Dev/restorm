import { ipcMain } from 'electron'
import { permissionService } from './PermissionService'
import { FIREWALL_IPC, type FirewallMode } from '../../../shared/types/firewall'

/**
 * Idempotent — calling twice silently rebinds, which is fine in
 * dev because electron-vite restarts the main process on edits
 * and clears the previous handlers.
 */
let installed = false

export function registerFirewallIpc(): void {
	if (installed) return
	installed = true

	ipcMain.handle(FIREWALL_IPC.GET_MODE, () => permissionService.getMode())

	ipcMain.handle(FIREWALL_IPC.SET_MODE, (_event, mode: unknown) => {
		if (mode !== 'strict' && mode !== 'log-only' && mode !== 'lockdown') {
			throw new Error(`Invalid firewall mode: ${String(mode)}`)
		}
		permissionService.setMode(mode as FirewallMode)
	})

	ipcMain.handle(FIREWALL_IPC.LIST_ALLOWLIST, () => permissionService.listAllowlist())

	ipcMain.handle(FIREWALL_IPC.ADD_ALLOWLIST, (_event, pattern: unknown) => {
		if (typeof pattern !== 'string' || pattern.trim().length === 0) {
			throw new Error('Allowlist entry must be a non-empty string')
		}
		permissionService.addToAllowlist(pattern)
	})

	ipcMain.handle(FIREWALL_IPC.REMOVE_ALLOWLIST, (_event, pattern: unknown) => {
		if (typeof pattern !== 'string') {
			throw new Error('Allowlist entry must be a string')
		}
		permissionService.removeFromAllowlist(pattern)
	})
}
