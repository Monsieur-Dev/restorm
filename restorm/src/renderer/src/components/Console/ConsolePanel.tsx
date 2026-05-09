import React, { useCallback } from 'react'
import { useSetting } from 'electron-core-ui/renderer'
import { Console } from './Console'
import { ConsoleToolbar } from './ConsoleToolbar'
import { useConsoleFeed } from './useConsoleFeed'
import type { RequestRecord } from '../../../../shared/types/firewall'
import type { ConsoleShell } from './formatters'

interface ConsolePanelProps {
	/** Click-through hook for log lines; receives the originating
	 * record so the host can focus / open the source request. */
	onLineClick?: (record: RequestRecord) => void
	'data-testid'?: string
}

/**
 * Workbench-tab-ready Console surface: toolbar + xterm panel +
 * firewall-feed subscription. Lives at `restorm/src/renderer/src/
 * components/Console/`; consumed via the workbench tab kind that
 * Phase 2B introduces.
 *
 * Settings:
 * - `console:requestFormat` — controls the curl ↔ powershell
 *   default at panel mount; the toolbar toggle persists changes
 *   back to the same key so the choice survives across restarts.
 * - `console:showInternalCalls` — un-hides the renderer ↔ main
 *   GraphQL bridge traffic (filtered out of the user-facing feed
 *   by default).
 */
export const ConsolePanel: React.FC<ConsolePanelProps> = ({
	onLineClick,
	'data-testid': dataTestId
}) => {
	// Persisted shell choice: app-level setting, falls back to curl
	// when undefined (first run). Toggle changes write back to the
	// same key so the next session picks them up.
	const [persistedFormat, setPersistedFormat] = useSetting('console:requestFormat')
	const shell: ConsoleShell = persistedFormat === 'powershell' ? 'powershell' : 'curl'
	const handleShellChange = useCallback((next: ConsoleShell): void => {
		void setPersistedFormat(next)
	}, [setPersistedFormat])
	// Show-internal toggle — same persistence pattern.
	const [showInternalSetting, setShowInternalSetting] = useSetting('console:showInternalCalls')
	const showInternal = showInternalSetting === true
	const handleShowInternalChange = useCallback((next: boolean): void => {
		void setShowInternalSetting(next)
	}, [setShowInternalSetting])
	const { records, clear } = useConsoleFeed({ showInternal })
	return (
		<div
			data-testid={dataTestId ?? 'console-panel'}
			style={{
				display: 'flex',
				flexDirection: 'column',
				width: '100%',
				height: '100%',
				minHeight: 0
			}}
		>
			<ConsoleToolbar
				shell={shell}
				onShellChange={handleShellChange}
				onClear={clear}
				showInternal={showInternal}
				onShowInternalChange={handleShowInternalChange}
			/>
			{/* xterm renders its own scrollback inside the terminal
			 * canvas; wrapping it in a ScrollableElement creates a
			 * second scrollbar (the one the user reported as "ugly"
			 * — Chromium's default rather than Monaco-styled). The
			 * xterm-viewport's own bar is hidden via CSS in the
			 * companion stylesheet so the only visible scroll is
			 * xterm's native one driven by the FitAddon-sized
			 * viewport. */}
			<div style={{ flex: 1, minHeight: 0 }}>
				<Console records={records} shell={shell} {...(onLineClick ? { onLineClick } : {})} />
			</div>
		</div>
	)
}
