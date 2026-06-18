import { ipcMain } from 'electron'
import { permissionService } from './PermissionService'
import {
	FIREWALL_IPC,
	type FirewallOrigin,
	type FirewallPromptResolution
} from '../../../types/firewall'

/**
 * Idempotent guard. `ipcMain.handle` throws if a channel is
 * registered twice — the boolean keeps repeated calls (electron-
 * vite hot reloads, future call-sites that aren't sure) from
 * crashing the main process.
 */
let installed = false

function asOrigin(value: unknown): FirewallOrigin | null {
	if (typeof value !== 'object' || value === null) return null
	const raw = value as { scheme?: unknown; host?: unknown; port?: unknown }
	if (typeof raw.scheme !== 'string' || typeof raw.host !== 'string' || typeof raw.port !== 'number') return null
	return { scheme: raw.scheme, host: raw.host, port: Math.trunc(raw.port) }
}

function asOriginArray(value: unknown): FirewallOrigin[] {
	if (!Array.isArray(value)) return []
	const out: FirewallOrigin[] = []
	for (const v of value) {
		const o = asOrigin(v)
		if (o !== null) out.push(o)
	}
	return out
}

export function registerFirewallIpc(): void {
	if (installed) return
	installed = true

	ipcMain.handle(FIREWALL_IPC.LIST_WHITELIST, () => permissionService.listWhitelist())
	ipcMain.handle(FIREWALL_IPC.LIST_BLACKLIST, () => permissionService.listBlacklist())

	ipcMain.handle(FIREWALL_IPC.ADD_WHITELIST, (_event, origin: unknown) => {
		const o = asOrigin(origin)
		if (o === null) throw new Error('Invalid origin payload')
		permissionService.addToWhitelist(o)
	})
	ipcMain.handle(FIREWALL_IPC.REMOVE_WHITELIST, (_event, origin: unknown) => {
		const o = asOrigin(origin)
		if (o === null) throw new Error('Invalid origin payload')
		permissionService.removeFromWhitelist(o)
	})
	ipcMain.handle(FIREWALL_IPC.ADD_BLACKLIST, (_event, origin: unknown) => {
		const o = asOrigin(origin)
		if (o === null) throw new Error('Invalid origin payload')
		permissionService.addToBlacklist(o)
	})
	ipcMain.handle(FIREWALL_IPC.REMOVE_BLACKLIST, (_event, origin: unknown) => {
		const o = asOrigin(origin)
		if (o === null) throw new Error('Invalid origin payload')
		permissionService.removeFromBlacklist(o)
	})

	ipcMain.handle(FIREWALL_IPC.SET_PROJECT_ORIGINS, (_event, origins: unknown) => {
		permissionService.setProjectOrigins(asOriginArray(origins))
	})

	ipcMain.handle(FIREWALL_IPC.PROMPT_RESOLVE, (_event, payload: unknown) => {
		const r = payload as Partial<FirewallPromptResolution>
		if (typeof r.promptId !== 'string') {
			throw new Error('promptId must be a string')
		}
		if (r.verdict !== 'allow' && r.verdict !== 'deny') {
			throw new Error(`verdict must be allow|deny, got ${String(r.verdict)}`)
		}
		permissionService.resolvePrompt(r.promptId, r.verdict)
	})
}
