import React, { useCallback, useMemo, useState } from 'react'
import { Tabs, ControlGroup, InputBox, Button, IconView, ScrollableElement, useFeature, type Tab } from 'electron-core-ui/renderer'
import { useFirewallControl } from './useFirewallControl'
import { FIREWALL_TEST_BUTTON_FEATURE } from '../../../../main/featureFlags'
import './firewallPanel.css'
import type { FirewallOrigin } from '../../../../shared/types/firewall'

interface FirewallPanelProps {
	'data-testid'?: string
}

/**
 * Workbench panel for firewall administration. The model is
 * always-on prompting:
 *
 *   - Known destinations (whitelist OR project-derived origins
 *     OR restorm infra ports) pass silently.
 *   - Blacklisted destinations deny silently.
 *   - Anything else triggers a toast prompt the user resolves.
 *
 * Layout: a two-column header (large shield icon + title +
 * description), then a `Tabs` strip with `Whitelist (X)` /
 * `Blacklist (Y)` and a "Test outbound" CTA. Each table row is a
 * `ControlGroup` (label + remove icon button) — same chrome the
 * rest of restorm uses for joined input strips.
 */
export const FirewallPanel: React.FC<FirewallPanelProps> = ({
	'data-testid': dataTestId
}) => {
	const {
		whitelist,
		blacklist,
		ready,
		addToWhitelist,
		removeFromWhitelist,
		addToBlacklist,
		removeFromBlacklist
	} = useFirewallControl()

	const [whitelistDraft, setWhitelistDraft] = useState('')
	const [blacklistDraft, setBlacklistDraft] = useState('')
	const [activeTabId, setActiveTabId] = useState<string>('whitelist')
	const { isEnabled: testButtonEnabled } = useFeature(FIREWALL_TEST_BUTTON_FEATURE)

	const handleAddWhitelist = useCallback((): void => {
		const origin = parseOriginInput(whitelistDraft)
		if (origin === null) return
		void addToWhitelist(origin)
		setWhitelistDraft('')
	}, [whitelistDraft, addToWhitelist])

	const handleAddBlacklist = useCallback((): void => {
		const origin = parseOriginInput(blacklistDraft)
		if (origin === null) return
		void addToBlacklist(origin)
		setBlacklistDraft('')
	}, [blacklistDraft, addToBlacklist])

	const handleTestOutbound = useCallback((): void => {
		void fetch('https://www.google.com/').catch(() => { /* expected */ })
	}, [])

	const tabs = useMemo<Tab[]>(() => [
		{
			id: 'whitelist',
			label: `Whitelist (${String(whitelist.length)})`,
			useScrollableElement: false,
			content: (
				<OriginListSection
					testIdPrefix="firewall-whitelist"
					hint={
						<>
							Hosts that pass silently regardless of project state.
							Format: <code>scheme://host:port</code>. Default ports
							can be omitted.
						</>
					}
					placeholder="https://api.example.com"
					draft={whitelistDraft}
					onDraftChange={setWhitelistDraft}
					onAdd={handleAddWhitelist}
					origins={whitelist}
					onRemove={removeFromWhitelist}
				/>
			)
		},
		{
			id: 'blacklist',
			label: `Blacklist (${String(blacklist.length)})`,
			useScrollableElement: false,
			content: (
				<OriginListSection
					testIdPrefix="firewall-blacklist"
					hint={
						<>
							Hosts that deny silently regardless of any allow path.
							Adding here also removes a matching whitelist entry.
						</>
					}
					placeholder="https://tracker.example.com"
					draft={blacklistDraft}
					onDraftChange={setBlacklistDraft}
					onAdd={handleAddBlacklist}
					origins={blacklist}
					onRemove={removeFromBlacklist}
				/>
			)
		}
	], [whitelist, blacklist, whitelistDraft, blacklistDraft, handleAddWhitelist, handleAddBlacklist, removeFromWhitelist, removeFromBlacklist])

	if (!ready) {
		return (
			<div data-testid={dataTestId ?? 'firewall-panel'} className="firewall-panel firewall-panel--loading">
				Loading firewall configuration…
			</div>
		)
	}

	return (
		<ScrollableElement
			data-testid={dataTestId ?? 'firewall-panel'}
			className="firewall-panel"
		>
			<div className="firewall-panel__inner">
				<header className="firewall-panel__header">
					<div className="firewall-panel__header-icon">
						<IconView icon={{ type: 'codicon', value: 'shield' }} size={72} />
					</div>
					<div className="firewall-panel__header-text">
						<h1 className="firewall-panel__title">Firewall</h1>
						<p className="firewall-panel__intro">
							Restorm intercepts every outbound HTTP / HTTPS / fetch
							call at a low level (Chromium webRequest + main-
							process http/https/fetch monkey-patches) so a
							compromised npm dependency can&apos;t quietly exfiltrate
							your secrets, tokens or project data through a
							supply-chain attack. Unknown destinations trigger a
							toast prompt — your decision adds the origin to the
							matching list below.
						</p>
						{testButtonEnabled && (
							<div className="firewall-panel__header-test">
								<Button
									icon="globe"
									options={{ ariaLabel: 'Test outbound to google.com', title: 'Fires a renderer-side fetch to google.com — should trigger the firewall toast.' }}
									data-testid="firewall-test-outbound"
									onClick={handleTestOutbound}
									secondary
								>
									Test outbound to google.com
								</Button>
							</div>
						)}
					</div>
				</header>
				<div className="firewall-panel__tabs">
					<Tabs
						data-testid="firewall-tabs"
						tabs={tabs}
						activeTabId={activeTabId}
						onTabChange={setActiveTabId}
						keepMounted
					/>
				</div>
			</div>
		</ScrollableElement>
	)
}

interface OriginListSectionProps {
	testIdPrefix: string
	hint: React.ReactNode
	placeholder: string
	draft: string
	onDraftChange: (value: string) => void
	onAdd: () => void
	origins: FirewallOrigin[]
	onRemove: (origin: FirewallOrigin) => Promise<void>
}

const OriginListSection: React.FC<OriginListSectionProps> = ({
	testIdPrefix, hint, placeholder, draft, onDraftChange, onAdd, origins, onRemove
}) => {
	const draftValid = parseOriginInput(draft) !== null
	return (
		<div className="firewall-panel__tab-body" data-testid={`${testIdPrefix}-body`}>
			<p className="firewall-panel__hint">{hint}</p>
			<ControlGroup data-testid={`${testIdPrefix}-add-group`} className="firewall-panel__group">
				<InputBox
					data-testid={`${testIdPrefix}-input`}
					value={draft}
					onChange={onDraftChange}
					changeDebounceMs={0}
					onKeyDown={(e) => { if (e.key === 'Enter' && draftValid) onAdd() }}
					options={{ placeholder, ariaLabel: 'Origin (scheme://host:port)' }}
				/>
				<Button
					icon="add"
					options={{ ariaLabel: 'Add origin', title: 'Add origin to the list' }}
					data-testid={`${testIdPrefix}-add`}
					onClick={onAdd}
					disabled={!draftValid}
					secondary
				/>
			</ControlGroup>
			{origins.length === 0 ? (
				<div className="firewall-panel__empty">No entries yet.</div>
			) : (
				<ul className="firewall-panel__list">
					{origins.map((origin) => {
						const display = formatOrigin(origin)
						return (
							<li key={display} className="firewall-panel__list-row">
								<ControlGroup className="firewall-panel__group" data-testid={`${testIdPrefix}-row-${display}`}>
									<div className="firewall-panel__list-label" title={display}>
										<code>{display}</code>
									</div>
									<Button
										icon="trash"
										options={{ ariaLabel: `Remove ${display}`, title: `Remove ${display}` }}
										data-testid={`${testIdPrefix}-remove-${display}`}
										onClick={() => { void onRemove(origin) }}
										secondary
									/>
								</ControlGroup>
							</li>
						)
					})}
				</ul>
			)}
		</div>
	)
}

/**
 * Best-effort URL → `FirewallOrigin` parser. Accepts shorthands:
 *   - `host` → `(http, host, 80)`
 *   - `host:port` → `(http, host, port)`
 *   - `scheme://host[:port]` → full triple, port defaulted from
 *     scheme when absent.
 * Returns `null` for empty / malformed input so the Add button
 * stays disabled.
 */
function parseOriginInput(raw: string): FirewallOrigin | null {
	const trimmed = raw.trim()
	if (trimmed.length === 0) return null
	let candidate = trimmed
	if (!candidate.includes('://')) {
		candidate = `http://${candidate}`
	}
	let parsed: URL
	try { parsed = new URL(candidate) } catch { return null }
	const scheme = parsed.protocol.replace(/:$/, '').toLowerCase()
	if (parsed.hostname.length === 0) return null
	const defaultPort = scheme === 'https' || scheme === 'wss' ? 443 : 80
	const port = parsed.port !== '' ? Number(parsed.port) : defaultPort
	if (!Number.isFinite(port) || port < 0 || port > 65535) return null
	return { scheme, host: parsed.hostname.toLowerCase(), port }
}

function formatOrigin(origin: FirewallOrigin): string {
	const defaultPort = origin.scheme === 'https' || origin.scheme === 'wss' ? 443 : 80
	const portSuffix = origin.port === defaultPort ? '' : `:${String(origin.port)}`
	return `${origin.scheme}://${origin.host}${portSuffix}`
}
