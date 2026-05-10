import { useEffect, useRef } from 'react'
import { toasterService } from 'electron-core-ui/renderer'
import type { FirewallPromptPayload } from '../../../shared/types/firewall'
import { FirewallPromptBody } from './FirewallPromptBody'
import { refreshFirewallControl } from '../components/Firewall'

/**
 * Subscribe to `firewall:prompt-show` and surface each pending
 * permission decision as an indefinite toast in the app-level
 * toaster. The toast body holds two action buttons (Allow / Deny);
 * each click dispatches the resolution back to main via
 * `window.api.firewall.resolvePrompt` and dismisses the toast.
 *
 * One toast per origin (scheme + host + port) — main dedupes
 * prompts so consecutive subresource loads to the same destination
 * only generate one outstanding prompt at a time. The toast id
 * mirrors the promptId so external code can target the same
 * record.
 */
interface FirewallApi {
	onPromptShow: (cb: (payload: FirewallPromptPayload) => void) => () => void
	resolvePrompt: (promptId: string, verdict: 'allow' | 'deny') => Promise<void>
}

function getFirewallApi(): FirewallApi | null {
	const api = (window as unknown as { api?: { firewall?: FirewallApi } }).api?.firewall
	return api ?? null
}

export function useFirewallPromptToasts(): void {
	// Track open toast ids so we can dismiss on resolution. The map
	// is keyed by promptId (same string `toasterService.push` uses
	// for the toast id) so dismiss is a direct lookup.
	const openPrompts = useRef(new Set<string>())

	useEffect(() => {
		const firewall = getFirewallApi()
		if (firewall === null) return
		const off = firewall.onPromptShow((payload) => {
			const toastId = `firewall-prompt:${payload.promptId}`
			openPrompts.current.add(toastId)
			const resolve = (verdict: 'allow' | 'deny'): void => {
				void firewall.resolvePrompt(payload.promptId, verdict).then(() => {
					// Pull the panel snapshot back into sync — the
					// main-process `permissionService` just promoted
					// the origin into whitelist or blacklist; the
					// `useFirewallControl` store has no other path to
					// learn about it.
					void refreshFirewallControl()
				})
				toasterService.dismiss('app', toastId)
				openPrompts.current.delete(toastId)
			}
			toasterService.push('app', {
				id: toastId,
				title: 'Outbound request blocked',
				body: <FirewallPromptBody payload={payload} resolve={resolve} />
			})
		})
		return off
	}, [])
}
