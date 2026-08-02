import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toasterService } from '../Toaster/ToasterService'
import type { FirewallPromptPayload } from '../../../types/firewall'
import { FirewallPromptBody } from './FirewallPromptBody'
import { refreshFirewallControl } from './useFirewallControl'

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

	// The subscription is mount-once, so a `t` captured in its closure
	// would stay pinned to the language active at mount. Keep it in a
	// ref so a prompt raised after a language switch reads the current
	// translation.
	const { t } = useTranslation()
	const tRef = useRef(t)
	useEffect(() => { tRef.current = t }, [t])

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
				title: tRef.current('firewall.prompt.title'),
				body: <FirewallPromptBody payload={payload} resolve={resolve} />
			})
		})
		return off
	}, [])
}
