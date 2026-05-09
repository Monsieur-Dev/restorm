import React from 'react'
import { Button } from 'electron-core-ui/renderer'
import type { ConsoleShell } from './formatters'

interface ConsoleToolbarProps {
	shell: ConsoleShell
	onShellChange: (next: ConsoleShell) => void
	onClear: () => void
	showInternal: boolean
	onShowInternalChange: (next: boolean) => void
	'data-testid'?: string
}

/**
 * Toolbar above the xterm panel: 2-state shell toggle (curl /
 * powershell) + a Clear button. The toggle is global — flipping
 * it re-renders the entire scrollback in the new format. Clear
 * empties the in-memory buffer; subsequent records start fresh.
 */
export const ConsoleToolbar: React.FC<ConsoleToolbarProps> = ({
	shell,
	onShellChange,
	onClear,
	showInternal,
	onShowInternalChange,
	'data-testid': dataTestId
}) => {
	const isPS = shell === 'powershell'
	return (
		<div
			data-testid={dataTestId ?? 'console-toolbar'}
			style={{
				display: 'flex',
				alignItems: 'center',
				gap: 8,
				padding: '4px 8px',
				borderBottom: '1px solid var(--panel-border, rgba(127, 127, 127, 0.18))',
				flex: '0 0 auto'
			}}
		>
			<div
				role="group"
				aria-label="Shell flavor"
				style={{ display: 'inline-flex', borderRadius: 4, overflow: 'hidden', border: '1px solid var(--button-background, #2c4156)' }}
			>
				<button
					type="button"
					data-testid="console-toolbar-shell-curl"
					aria-pressed={!isPS}
					onClick={() => { onShellChange('curl') }}
					style={{
						padding: '2px 10px',
						background: !isPS ? 'var(--button-background, #2c4156)' : 'transparent',
						color: !isPS ? 'var(--button-foreground, #fff)' : 'var(--editor-foreground)',
						border: 'none',
						cursor: 'pointer',
						fontSize: 12,
					}}
				>curl</button>
				<button
					type="button"
					data-testid="console-toolbar-shell-powershell"
					aria-pressed={isPS}
					onClick={() => { onShellChange('powershell') }}
					style={{
						padding: '2px 10px',
						background: isPS ? 'var(--button-background, #2c4156)' : 'transparent',
						color: isPS ? 'var(--button-foreground, #fff)' : 'var(--editor-foreground)',
						border: 'none',
						borderLeft: '1px solid var(--button-background, #2c4156)',
						cursor: 'pointer',
						fontSize: 12,
					}}
				>powershell</button>
			</div>
			<div style={{ flex: 1 }} />
			<Button
				icon={showInternal ? 'eye' : 'eye-closed'}
				options={{
					ariaLabel: showInternal ? 'Hide internal calls' : 'Show internal calls',
					title: showInternal ? 'Hide internal calls' : 'Show internal calls'
				}}
				data-testid="console-toolbar-show-internal"
				onClick={() => { onShowInternalChange(!showInternal) }}
				secondary
				small
			/>
			<Button
				icon="clear-all"
				options={{ ariaLabel: 'Clear console', title: 'Clear console' }}
				data-testid="console-toolbar-clear"
				onClick={onClear}
				secondary
				small
			/>
		</div>
	)
}
