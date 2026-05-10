import type { FirewallPromptPayload } from '../../../shared/types/firewall'

interface FirewallPromptBodyProps {
	payload: FirewallPromptPayload
	resolve: (verdict: 'allow' | 'deny') => void
}

/**
 * Toast body for the firewall pending-permission prompt. Two
 * buttons only — there's no per-call vs persistent distinction
 * anymore: `Allow` adds the origin to the whitelist (so the next
 * call passes silently), `Deny` adds it to the blacklist (so the
 * next call denies silently).
 */
export function FirewallPromptBody({ payload, resolve }: FirewallPromptBodyProps): React.JSX.Element {
	const display = renderOrigin(payload)
	return (
		<div className="firewall-prompt-toast">
			<div className="firewall-prompt-toast__destination">
				<code>{display}</code>
			</div>
			<div className="firewall-prompt-toast__source">
				{payload.source}
			</div>
			<div className="firewall-prompt-toast__actions">
				<button
					type="button"
					data-testid="firewall-prompt-allow"
					className="firewall-prompt-toast__primary"
					onClick={() => { resolve('allow') }}
				>
					Allow
				</button>
				<button
					type="button"
					data-testid="firewall-prompt-deny"
					onClick={() => { resolve('deny') }}
				>
					Deny
				</button>
			</div>
		</div>
	)
}

function renderOrigin(payload: FirewallPromptPayload): string {
	const o = payload.origin
	const defaultPort = o.scheme === 'https' || o.scheme === 'wss' ? 443 : 80
	const portSuffix = o.port === defaultPort ? '' : `:${String(o.port)}`
	return `${o.scheme}://${o.host}${portSuffix}`
}
