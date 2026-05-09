import React, { useState } from 'react'
import { Console } from './Console'
import { ConsoleToolbar } from './ConsoleToolbar'
import { useConsoleFeed } from './useConsoleFeed'
import type { RequestRecord } from '../../../../shared/types/firewall'
import type { ConsoleShell } from './formatters'

interface ConsolePanelProps {
	/** Initial shell flavor; defaults to `curl`. Phase 5 will wire
	 * this to the persisted `restorm.console.requestFormat` app
	 * setting so the toggle survives across sessions. */
	defaultShell?: ConsoleShell
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
 */
export const ConsolePanel: React.FC<ConsolePanelProps> = ({
	defaultShell = 'curl',
	onLineClick,
	'data-testid': dataTestId
}) => {
	const [shell, setShell] = useState<ConsoleShell>(defaultShell)
	const { records, clear } = useConsoleFeed()
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
			<ConsoleToolbar shell={shell} onShellChange={setShell} onClear={clear} />
			<div style={{ flex: 1, minHeight: 0 }}>
				<Console records={records} shell={shell} {...(onLineClick ? { onLineClick } : {})} />
			</div>
		</div>
	)
}
