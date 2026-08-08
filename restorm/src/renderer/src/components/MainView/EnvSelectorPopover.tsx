import React, { Fragment, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { IconView, Toggle } from 'electron-core-ui/renderer'
import { DEFAULT_ENV_COLOR, type FlatEnvRow } from './envSelectorHelpers'

/** Parse a `#rgb` or `#rrggbb` hex string into r/g/b bytes. Returns
 * `null` if the input isn't a well-formed hex — callers then fall
 * back to the raw color as a `background-color`. */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
	const normalized = hex.replace('#', '')
	const full = normalized.length === 3
		? normalized.split('').map((c) => c + c).join('')
		: normalized
	if (full.length !== 6) return null
	const r = Number.parseInt(full.slice(0, 2), 16)
	const g = Number.parseInt(full.slice(2, 4), 16)
	const b = Number.parseInt(full.slice(4, 6), 16)
	if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null
	return { r, g, b }
}

/** Convert an env color (hex or arbitrary CSS) to an `rgba(...)` tint
 * at the requested alpha. Used for the icon badge background + the
 * selected-row background — a desaturated wash of the env color reads
 * as "tagged with this color" without overpowering the row's
 * foreground. Returns the original color string when it isn't a
 * parseable hex, so a CSS variable or named colour still lands
 * somewhere visible. */
function envColorTint(color: string, alpha: number): string {
	const rgb = hexToRgb(color)
	if (!rgb) return color
	return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`
}

export interface EnvPopoverListProps {
	rows: FlatEnvRow[]
	selectedEnvId: string | null
	applyToAll: boolean
	onApplyToAllChange: (next: boolean) => void
	onSelect: (envId: string) => void
	/** Called when the user picks an env (after `onSelect` fires) so the
	 * host can dismiss its surrounding tooltip / popover. Statusbar host
	 * forwards `closeTooltip` from `useStatusbarTooltip`; the Send-button
	 * host flips its local open state. */
	onCloseRequested?: () => void
	/** Test-id prefix for the popover internals. The statusbar is the
	 * default host, so its prefix is the default; other hosts (the
	 * Send button, a scenario request node) override it so two popovers
	 * on screen stay distinguishable. */
	testIdPrefix?: string
	/** Hide the "Apply to all requests" footer — used by hosts where the
	 * selection is scoped to a single target (e.g. a scenario request node). */
	hideApplyToAll?: boolean
}

/**
 * Vertical list of environments rendered inside a tooltip / popover.
 * The shared shape used by both the statusbar env selector and the
 * Send-button right-click switcher — they both want the same picker,
 * just anchored to different elements.
 *
 * Each row renders: 4×fullHeight color rail · 28×28 env-tinted icon
 * badge · env name · check codicon when active. The env's color is
 * carried by rail + badge + (when selected) row-bg tint, never by
 * the foreground text — selection state therefore reinforces the
 * env's identifier instead of fighting it.
 */
export const EnvPopoverList: React.FC<EnvPopoverListProps> = ({ rows, selectedEnvId, applyToAll, onApplyToAllChange, onSelect, onCloseRequested, testIdPrefix = 'statusbar-env-selector', hideApplyToAll = false }) => {
	const { t } = useTranslation()
	const handleEnvClick = useCallback((envId: string): void => {
		onSelect(envId)
		onCloseRequested?.()
	}, [onSelect, onCloseRequested])
	return (
		<div
			role="listbox"
			aria-label="environments"
			data-testid={`${testIdPrefix}-listview`}
			style={{
				minWidth: 260,
				maxHeight: 380,
				overflow: 'auto',
				padding: 6,
				display: 'flex',
				flexDirection: 'column',
				gap: 1
			}}
		>
			{rows.map(({ env, depth, groupLabel }, i) => {
				const bg = env.color ?? DEFAULT_ENV_COLOR
				const isSelected = env.id === selectedEnvId
				const nextDepth = rows[i + 1]?.depth
				const isParentToChildBoundary = depth === 0 && typeof nextDepth === 'number' && nextDepth > 0
				const isLastRow = i === rows.length - 1
				// Header above the first row of each group (its owning env folder).
				const showGroupHeader = groupLabel !== undefined && groupLabel !== rows[i - 1]?.groupLabel
				return (
					<Fragment key={env.id}>
						{showGroupHeader && (
							<div
								data-testid={`${testIdPrefix}-group-${i}`}
								style={{
									padding: '6px 8px 4px',
									marginTop: i === 0 ? 0 : 8,
									fontSize: 11,
									fontWeight: 600,
									letterSpacing: '0.04em',
									textTransform: 'uppercase',
									color: 'var(--descriptionForeground, var(--foreground))',
									opacity: 0.75,
									whiteSpace: 'nowrap',
									overflow: 'hidden',
									textOverflow: 'ellipsis'
								}}
							>
								{groupLabel}
							</div>
						)}
						<div
							role="option"
							aria-selected={isSelected}
							data-testid={`${testIdPrefix}-item-${env.id}`}
							onClick={(): void => { handleEnvClick(env.id) }}
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: 10,
								padding: '6px 8px 6px 0',
								marginLeft: depth * 24,
								borderRadius: 4,
								cursor: 'pointer',
								position: 'relative',
								// Selection bg is a low-alpha tint of the env's
								// own color rather than the global ECUI active-
								// selection (teal) — keeps the env's identifier
								// visible even when it's a clashing hue.
								background: isSelected ? envColorTint(bg, 0.18) : 'transparent',
								color: 'var(--foreground)',
								// Skip the row's own hairline when the next
								// element is the parent-to-child divider —
								// otherwise the two lines stack into a double
								// rule under the root env.
								borderBottom: (isLastRow || isParentToChildBoundary)
									? 'none'
									: '1px solid var(--dropdown-border, rgba(128,128,128,0.15))'
							}}
							onMouseEnter={(e): void => {
								if (!isSelected) e.currentTarget.style.background = 'var(--list-hoverBackground, rgba(128,128,128,0.08))'
							}}
							onMouseLeave={(e): void => {
								if (!isSelected) e.currentTarget.style.background = 'transparent'
							}}
						>
							{/* Color rail anchored to the row's left edge. */}
							<span
								aria-hidden="true"
								style={{
									width: 4,
									alignSelf: 'stretch',
									borderRadius: 2,
									background: bg,
									flexShrink: 0
								}}
							/>
							{/* Icon badge — tinted with the env's own color so
							    the identifier reads from two places (rail +
							    badge) and the icon — emoji, codicon, SVG
							    library — sits in a consistent visual
							    container regardless of source. */}
							<span
								style={{
									width: 28,
									height: 28,
									borderRadius: 6,
									background: envColorTint(bg, 0.18),
									color: bg,
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									flexShrink: 0
								}}
							>
								{env.icon ? <IconView icon={env.icon} size={20} /> : null}
							</span>
							<span
								style={{
									flex: 1,
									overflow: 'hidden',
									textOverflow: 'ellipsis',
									whiteSpace: 'nowrap',
									fontSize: 13
								}}
							>
								{env.name}
							</span>
							{isSelected && (
								<span
									className="codicon codicon-check"
									aria-hidden="true"
									style={{ color: bg, fontSize: 16 }}
								/>
							)}
						</div>
						{isParentToChildBoundary && (
							<div
								aria-hidden="true"
								style={{
									borderTop: '1px solid var(--dropdown-border, rgba(128,128,128,0.2))',
									margin: '4px 4px'
								}}
							/>
						)}
					</Fragment>
				)
			})}
			{!hideApplyToAll && (
			<div
				data-testid={`${testIdPrefix}-apply-to-all`}
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: 6,
					marginTop: 6,
					padding: '8px 8px 4px',
					fontSize: 12,
					color: 'var(--descriptionForeground, var(--foreground))',
					borderTop: '1px solid var(--dropdown-border, rgba(128,128,128,0.2))',
					cursor: 'pointer'
				}}
			>
				<Toggle checked={applyToAll} onChange={(checked): void => { onApplyToAllChange(checked) }} aria-label={t('statusbar.envSelector.applyToAll', 'Apply to all requests')} data-testid={`${testIdPrefix}-apply-to-all-input`}>
					<span>{t('statusbar.envSelector.applyToAll', 'Apply to all requests')}</span>
				</Toggle>
			</div>
			)}
		</div>
	)
}

export default EnvPopoverList
