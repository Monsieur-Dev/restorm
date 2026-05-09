import { useEffect, useRef } from 'react'
import { toasterService } from 'electron-core-ui/renderer'
import type { FirewallPromptPayload } from '../../../shared/types/firewall'
import { FirewallPromptBody } from './FirewallPromptBody'

/**
 * Subscribe to `firewall:prompt-show` and surface each pending
 * permission decision as an indefinite toast in the app-level
 * toaster. The toast body holds four action buttons (Allow once /
 * Allow always / Deny once / Deny always); each click dispatches
 * the resolution back to main via `window.api.firewall.resolvePrompt`
 * and dismisses the toast.
 *
 * One toast per `host:port` — main dedupes prompts so consecutive
 * subresource loads to the same destination only generate one
 * outstanding prompt at a time. The toast id mirrors the promptId
 * so external code (Settings panel "review pending prompts" later)
 * can target the same record.
 */
interface FirewallApi {
	onPromptShow: (cb: (payload: FirewallPromptPayload) => void) => () => void
	resolvePrompt: (promptId: string, verdict: 'allow' | 'deny', persist: boolean) => Promise<void>
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
			const resolve = (verdict: 'allow' | 'deny', persist: boolean): void => {
				void firewall.resolvePrompt(payload.promptId, verdict, persist)
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
