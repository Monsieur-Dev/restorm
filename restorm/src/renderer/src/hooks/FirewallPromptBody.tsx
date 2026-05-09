import type { FirewallPromptPayload } from '../../../shared/types/firewall'

interface FirewallPromptBodyProps {
	payload: FirewallPromptPayload
	resolve: (verdict: 'allow' | 'deny', persist: boolean) => void
}

/**
 * Toast body for the firewall pending-permission prompt. Lives in
 * its own file so the hook module stays component-free (Vite fast
 * refresh only re-mounts files that exclusively export components,
 * not files that mix hooks + components).
 */
export function FirewallPromptBody({ payload, resolve }: FirewallPromptBodyProps): React.JSX.Element {
	return (
		<div className="firewall-prompt-toast">
			<div className="firewall-prompt-toast__destination">
				<code>{payload.host}:{String(payload.port)}</code>
			</div>
			<div className="firewall-prompt-toast__source">
				{payload.source}
			</div>
			<div className="firewall-prompt-toast__actions">
				<button
					type="button"
					data-testid="firewall-prompt-allow-once"
					onClick={() => { resolve('allow', false) }}
				>
					Allow once
				</button>
				<button
					type="button"
					data-testid="firewall-prompt-allow-always"
					className="firewall-prompt-toast__primary"
					onClick={() => { resolve('allow', true) }}
				>
					Allow always
				</button>
				<button
					type="button"
					data-testid="firewall-prompt-deny-once"
					onClick={() => { resolve('deny', false) }}
				>
					Deny once
				</button>
				<button
					type="button"
					data-testid="firewall-prompt-deny-always"
					onClick={() => { resolve('deny', true) }}
				>
					Deny always
				</button>
			</div>
		</div>
	)
}
