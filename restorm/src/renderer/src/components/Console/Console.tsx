import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import type { RequestRecord } from '../../../../shared/types/firewall'
import { renderRecord, type ConsoleShell } from './formatters'

/**
 * ANSI colour helper. xterm.js consumes raw ANSI escape codes via
 * `term.write` — we map verbs / verdicts to a simple palette so the
 * scrollback reads at a glance.
 */
const ANSI = {
	reset: '\x1b[0m',
	dim: '\x1b[2m',
	get: '\x1b[32m',         // green
	post: '\x1b[34m',        // blue
	put: '\x1b[33m',         // yellow
	delete: '\x1b[31m',      // red
	patch: '\x1b[35m',       // magenta
	otherVerb: '\x1b[36m',   // cyan
	denied: '\x1b[31m',      // red (verdict)
	internal: '\x1b[2;37m',  // dim grey (internal calls when shown)
}

function colourForMethod(method: string): string {
	switch (method.toUpperCase()) {
		case 'GET': return ANSI.get
		case 'POST': return ANSI.post
		case 'PUT': return ANSI.put
		case 'DELETE': return ANSI.delete
		case 'PATCH': return ANSI.patch
		default: return ANSI.otherVerb
	}
}

function buildBlock(record: RequestRecord, shell: ConsoleShell): string {
	const ts = record.timestamp.replace('T', ' ').replace(/\..+$/, '')
	const verbColour = colourForMethod(record.method)
	const verdictTag = record.verdict === 'deny'
		? `${ANSI.denied}DENIED${ANSI.reset} `
		: record.verdict === 'pending'
			? `${ANSI.dim}PENDING${ANSI.reset} `
			: ''
	const internalTag = record.protocol === 'internal'
		? `${ANSI.internal}[internal]${ANSI.reset} `
		: ''
	const header =
		`${ANSI.dim}# ${ts}${ANSI.reset} ` +
		`${verbColour}${record.method}${ANSI.reset} ` +
		`${ANSI.dim}${record.host}:${String(record.port)}${ANSI.reset}` +
		(internalTag ? ` ${internalTag}` : '') +
		(verdictTag ? ` ${verdictTag}` : '')
	const body = renderRecord(record, shell)
	return `${header}\r\n${body}\r\n`
}

interface ConsoleProps {
	records: RequestRecord[]
	shell: ConsoleShell
	onLineClick?: (record: RequestRecord) => void
	'data-testid'?: string
}

/**
 * Read-only xterm.js panel that re-renders the entire scrollback
 * whenever the records buffer or the shell flavor changes. Cheap
 * enough at 10 000 records (xterm streams ~140 KB of ANSI to a
 * GPU-rendered grid in a few ms); we skip incremental writes to
 * keep the click-through registry simple — see `clickRecordRefs`.
 */
export const Console: React.FC<ConsoleProps> = ({ records, shell, onLineClick, 'data-testid': dataTestId }) => {
	const containerRef = useRef<HTMLDivElement>(null)
	const termRef = useRef<Terminal | null>(null)
	const fitRef = useRef<FitAddon | null>(null)
	// Map xterm row → record id so a click can resolve back to the
	// originating `RequestRecord`. Re-built on every full render so
	// we don't need incremental writes.
	const rowToRecordId = useRef<Map<number, string>>(new Map())
	const recordsById = useMemo<Map<string, RequestRecord>>(() => {
		const m = new Map<string, RequestRecord>()
		for (const r of records) m.set(r.id, r)
		return m
	}, [records])

	// One-time terminal init.
	useEffect(() => {
		const node = containerRef.current
		if (!node) return
		const term = new Terminal({
			disableStdin: true,
			fontFamily: 'var(--monospace-font, Consolas, "Courier New", monospace)',
			fontSize: 13,
			lineHeight: 1.25,
			scrollback: 50_000,
			convertEol: true,
			cursorBlink: false,
			cursorStyle: 'bar',
			theme: {
				background: '#00000000',  // transparent — let the workbench bg show
				foreground: '#dadada'
			},
			allowTransparency: true,
		})
		const fit = new FitAddon()
		const search = new SearchAddon()
		const links = new WebLinksAddon()
		term.loadAddon(fit)
		term.loadAddon(search)
		term.loadAddon(links)
		term.open(node)
		try { fit.fit() } catch { /* noop — tab not visible yet */ }
		termRef.current = term
		fitRef.current = fit

		const handleResize = (): void => {
			try { fit.fit() } catch { /* noop */ }
		}
		const ro = new ResizeObserver(handleResize)
		ro.observe(node)

		return () => {
			ro.disconnect()
			term.dispose()
			termRef.current = null
			fitRef.current = null
		}
	}, [])

	// Re-render scrollback on records / shell change. Full re-write
	// is fine at our buffer cap (10k records ≈ ~140 KB of ANSI).
	useEffect(() => {
		const term = termRef.current
		if (!term) return
		term.clear()
		rowToRecordId.current.clear()
		let row = 0
		for (const record of records) {
			const block = buildBlock(record, shell)
			const lineCount = block.split('\r\n').length - 1
			rowToRecordId.current.set(row, record.id)
			row += lineCount
			term.write(block)
		}
		term.scrollToBottom()
	}, [records, shell])

	// Click handler: map xterm row → record id → notify parent.
	const handleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
		if (!onLineClick) return
		const term = termRef.current
		if (!term) return
		const rowAttr = (event.target as HTMLElement | null)?.closest('[role="presentation"]')
			?.querySelector('.xterm-rows')
		void rowAttr // xterm doesn't expose row from a DOM event directly; placeholder for now
		// Best-effort: use term.buffer.active.cursorY as the active row when
		// the terminal grabs focus on click. xterm's mouse handler hooks are
		// preferred — but those require addon plumbing we can wire later.
		const cursorY = term.buffer.active.cursorY
		const id = rowToRecordId.current.get(cursorY)
		if (id !== undefined) {
			const record = recordsById.get(id)
			if (record) onLineClick(record)
		}
	}, [onLineClick, recordsById])

	return (
		<div
			ref={containerRef}
			onClick={handleClick}
			style={{ width: '100%', height: '100%', minHeight: 0, padding: 4 }}
			data-testid={dataTestId ?? 'console-xterm'}
		/>
	)
}
