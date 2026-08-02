import { useTranslation } from 'react-i18next'
import { Button } from '../Button'
import type { FirewallPromptPayload } from '../../../types/firewall'
import './firewallPromptToast.css'

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
	const { t } = useTranslation()
	const display = renderOrigin(payload)
	return (
		<div className="firewall-prompt-toast">
			<div className="firewall-prompt-toast__destination">
				<code>{display}</code>
			</div>
			<div className="firewall-prompt-toast__source">
				{payload.source}
				{payload.originHint !== undefined && payload.originHint !== '' && (
					// The whole "from <hint>" clause is one translated
					// string so locales that put the origin first (ja, ko,
					// tr…) can order it their way.
					<span className="firewall-prompt-toast__origin-hint">
						{' '}— {t('firewall.prompt.fromOrigin', { origin: payload.originHint })}
					</span>
				)}
			</div>
			<div className="firewall-prompt-toast__actions">
				<Button
					className="firewall-prompt-toast__primary"
					data-testid="firewall-prompt-allow"
					onClick={() => { resolve('allow') }}
				>
					{t('firewall.prompt.allow')}
				</Button>
				<Button
					data-testid="firewall-prompt-deny"
					onClick={() => { resolve('deny') }}
				>
					{t('firewall.prompt.deny')}
				</Button>
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
