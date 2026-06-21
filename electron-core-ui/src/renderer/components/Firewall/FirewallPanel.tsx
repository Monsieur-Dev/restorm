import React, { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tabs, type Tab } from '../Tabs'
import { ControlGroup } from '../ControlGroup'
import { InputBox } from '../InputBox'
import { Button } from '../Button'
import { IconView } from '../IconView'
import { ScrollableElement } from '../ScrollableElement'
import { useFeature } from '../../hooks/useFeature'
import { useFirewallControl } from './useFirewallControl'
import { Tooltip } from '../Tooltip'
import './firewallPanel.css'
import type { FirewallOrigin } from '../../../types/firewall'

export interface FirewallPanelProps {
	'data-testid'?: string
	/**
	 * The host application's display name, interpolated into the panel's
	 * intro copy ("<appName> intercepts every outbound …"). No app name
	 * is baked into this generic component — the consumer supplies it.
	 * Defaults to a neutral "This application".
	 */
	appName?: string
	/**
	 * Feature-flag name that gates the developer-only "Test outbound"
	 * CTA. When omitted, the button is never shown. The consuming app
	 * passes its own flag name (backed by its feature service) so the
	 * button only appears in the builds it wants.
	 */
	testButtonFeature?: string
}

/**
 * Workbench panel for firewall administration. The model is
 * always-on prompting:
 *
 *   - Known destinations (whitelist OR project-derived origins
 *     OR the host app's infra ports) pass silently.
 *   - Blacklisted destinations deny silently.
 *   - Anything else triggers a toast prompt the user resolves.
 *
 * Layout: a two-column header (large shield icon + title +
 * description), then a `Tabs` strip with `Whitelist (X)` /
 * `Blacklist (Y)` and a "Test outbound" CTA. Each table row is a
 * `ControlGroup` (label + remove icon button) — same chrome the
 * rest of the library uses for joined input strips.
 */
export const FirewallPanel: React.FC<FirewallPanelProps> = ({
	'data-testid': dataTestId,
	appName,
	testButtonFeature
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
	// `useFeature` must run unconditionally (rules of hooks); pass an
	// empty flag name when the consumer didn't supply one — the empty
	// flag resolves to disabled, and we gate the button on the name
	// being present anyway.
	const { isEnabled: testFlagEnabled } = useFeature(testButtonFeature ?? '')
	const testButtonEnabled = testButtonFeature !== undefined && testButtonFeature !== '' && testFlagEnabled

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
							can be omitted. Subdomain wildcards (one level only):
							<code>https://*.example.com</code>. Port wildcard:
							<code>:*</code>.
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
							{appName ?? 'This application'} intercepts every
							outbound HTTP / HTTPS / fetch call at a low level
							(Chromium webRequest + main-process http/https/fetch
							monkey-patches) so a compromised npm dependency
							can&apos;t quietly exfiltrate your secrets, tokens or
							project data through a supply-chain attack. Unknown
							destinations trigger a toast prompt — your decision
							adds the origin to the matching list below.
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
	const { t } = useTranslation()
	const draftValid = parseOriginInput(draft) !== null
	const labelTooltipRef = useRef<HTMLElement | null>(null)
	const [hoveredLabel, setHoveredLabel] = useState<string | null>(null)
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
					options={{ ariaLabel: t('firewall.addOrigin', 'Add origin') }}
					data-testid={`${testIdPrefix}-add`}
					onClick={onAdd}
					disabled={!draftValid}
					secondary
				/>
			</ControlGroup>
			{origins.length === 0 ? (
				<div className="firewall-panel__empty">{t('firewall.noEntries', 'No entries yet.')}</div>
			) : (
				<ul className="firewall-panel__list">
					{origins.map((origin) => {
						const display = formatOrigin(origin)
						return (
							<li key={display} className="firewall-panel__list-row">
								<ControlGroup className="firewall-panel__group" data-testid={`${testIdPrefix}-row-${display}`}>
									<div
										className="firewall-panel__list-label"
										aria-label={display}
										onMouseEnter={(e) => { labelTooltipRef.current = e.currentTarget; setHoveredLabel(display) }}
										onMouseLeave={() => { setHoveredLabel(null) }}
									>
										<code>{display}</code>
									</div>
									<Button
										icon="trash"
										options={{ ariaLabel: t('firewall.removeOrigin', 'Remove {{origin}}', { origin: display }) }}
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
			<Tooltip
				targetRef={labelTooltipRef as React.RefObject<HTMLElement>}
				content={hoveredLabel}
				show={hoveredLabel !== null}
				placement="below"
			/>
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
/**
 * Parse a free-form origin string into a `FirewallOrigin`. Supports
 * two glob forms in addition to plain origins:
 *
 *   - Subdomain wildcard: `https://*.example.com[:port]` matches
 *     exactly one subdomain level (`api.example.com`, NOT
 *     `example.com` and NOT `a.b.example.com`).
 *   - Port wildcard: `:*` parses to the reserved sentinel `0`, which
 *     `PermissionService.matches` interprets as "any port".
 *
 * Returns `null` for empty / malformed input so the Add button stays
 * disabled. The native `URL` parser rejects `*` in the host, so we
 * substitute a placeholder while parsing and restore it afterwards.
 */
function parseOriginInput(raw: string): FirewallOrigin | null {
	const trimmed = raw.trim()
	if (trimmed.length === 0) return null
	let candidate = trimmed
	if (!candidate.includes('://')) {
		candidate = `http://${candidate}`
	}
	const wildcardPort = candidate.endsWith(':*')
	if (wildcardPort) candidate = candidate.slice(0, -2)
	const wildcardSubdomain = candidate.includes('://*.')
	// Pre-validate raw input: Chromium's `URL` parser percent-encodes
	// `*` as `%2A` instead of throwing (so a leftover `*` somewhere
	// other than the leading `*.` form would be silently turned into
	// a string-literal entry that survives `isValidHostPattern`'s
	// post-parse check). Reject any `*` that's not the leading `*.`
	// or the trailing `:*` form before handing the string to URL().
	const hostPart = candidate.split('://')[1] ?? ''
	const hostOnly = hostPart.split(/[/?#]/)[0] ?? ''
	if (hostOnly.includes('*') && !wildcardSubdomain) return null
	if (wildcardSubdomain) candidate = candidate.replace('://*.', '://__wildcard__.')
	let parsed: URL
	try { parsed = new URL(candidate) } catch { return null }
	const scheme = parsed.protocol.replace(/:$/, '').toLowerCase()
	let host = parsed.hostname.toLowerCase()
	if (wildcardSubdomain) {
		if (!host.startsWith('__wildcard__.')) return null
		host = `*.${host.slice('__wildcard__.'.length)}`
	}
	if (host.length === 0) return null
	if (!isValidHostPattern(host)) return null
	const defaultPort = scheme === 'https' || scheme === 'wss' ? 443 : 80
	const port = wildcardPort
		? 0
		: parsed.port !== '' ? Number(parsed.port) : defaultPort
	if (!wildcardPort && (!Number.isFinite(port) || port < 0 || port > 65535)) return null
	return { scheme, host, port }
}

/**
 * Mirror of `PermissionService.isValidHostPattern` — kept inline here
 * (rather than imported across the main/renderer boundary) so the
 * disabled-state of the Add button reflects the same constraints the
 * persistence layer enforces. Renderer-side validation also catches
 * the case where Node's URL parser quietly accepts a `*` outside the
 * leading `*.` form (`new URL("https://*foo")` yields hostname
 * `"*foo"` rather than throwing).
 */
function isValidHostPattern(host: string): boolean {
	if (host.length === 0) return false
	if (host === '*') return false
	if (host.startsWith('*.')) {
		const rest = host.slice(2)
		if (rest.length === 0) return false
		if (rest.includes('*')) return false
		if (rest.startsWith('.') || rest.endsWith('.')) return false
		return true
	}
	return !host.includes('*')
}

function formatOrigin(origin: FirewallOrigin): string {
	const defaultPort = origin.scheme === 'https' || origin.scheme === 'wss' ? 443 : 80
	const portSuffix = origin.port === 0
		? ':*'
		: origin.port === defaultPort ? '' : `:${String(origin.port)}`
	return `${origin.scheme}://${origin.host}${portSuffix}`
}
