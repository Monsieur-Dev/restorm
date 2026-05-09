import React, { useCallback, useEffect, useState } from 'react'
import { StatusbarElement } from 'electron-core-ui/renderer'
import type { FirewallMode, RequestRecord } from '../../../../shared/types/firewall'

interface FirewallApi {
	getMode: () => Promise<FirewallMode>
	setMode: (mode: FirewallMode) => Promise<void>
	onRecord: (cb: (record: RequestRecord) => void) => () => void
}

function getFirewallApi(): FirewallApi | null {
	const api = (window as unknown as { api?: { firewall?: FirewallApi } }).api?.firewall
	return api ?? null
}

const NEXT_MODE: Record<FirewallMode, FirewallMode> = {
	strict: 'log-only',
	'log-only': 'lockdown',
	lockdown: 'strict'
}

const MODE_LABEL: Record<FirewallMode, string> = {
	strict: 'strict',
	'log-only': 'log only',
	lockdown: 'lockdown'
}

/**
 * Statusbar element that displays the firewall mode and bumps a
 * ripple every time a `RequestRecord` lands with `verdict: 'deny'`
 * — same `pulseSignal` mechanic the MCP indicator uses for incoming
 * MCP traffic. Click cycles through `strict → log-only → lockdown`
 * so the user can quickly disable the toast prompts without
 * opening Settings.
 *
 * The indicator never fully hides — even `log-only` mode is worth
 * surfacing so the user remembers the audit log is filling.
 */
export const StatusbarFirewallIndicator: React.FC = () => {
	const [mode, setMode] = useState<FirewallMode | null>(null)
	const [pulseSignal, setPulseSignal] = useState(0)
	const [denyCount, setDenyCount] = useState(0)

	useEffect(() => {
		const firewall = getFirewallApi()
		if (firewall === null) return
		let cancelled = false
		void firewall.getMode().then((current) => {
			if (cancelled) return
			setMode(current)
		})
		return () => { cancelled = true }
	}, [])

	useEffect(() => {
		const firewall = getFirewallApi()
		if (firewall === null) return
		return firewall.onRecord((record) => {
			if (record.verdict !== 'deny') return
			setPulseSignal((p) => p + 1)
			setDenyCount((c) => c + 1)
		})
	}, [])

	const handleClick = useCallback(() => {
		if (mode === null) return
		const firewall = getFirewallApi()
		if (firewall === null) return
		const next = NEXT_MODE[mode]
		setMode(next)
		void firewall.setMode(next)
	}, [mode])

	if (mode === null) return null

	return (
		<StatusbarElement
			data-testid="statusbar-firewall-indicator"
			icon={{ type: 'codicon', value: 'shield' }}
			title={`firewall: ${MODE_LABEL[mode]}`}
			tooltipTrigger="hover"
			tooltipPlacement="above"
			onClick={handleClick}
			pulseSignal={pulseSignal}
		>
			<div
				data-testid="statusbar-firewall-popover"
				style={{ padding: '8px 12px', whiteSpace: 'nowrap', maxWidth: 260 }}
			>
				<div><strong>Firewall: {MODE_LABEL[mode]}</strong></div>
				<div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>
					Click to cycle (strict → log only → lockdown)
				</div>
				{denyCount > 0 && (
					<div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>
						{denyCount} request{denyCount === 1 ? '' : 's'} denied this session
					</div>
				)}
			</div>
		</StatusbarElement>
	)
}

export default StatusbarFirewallIndicator
