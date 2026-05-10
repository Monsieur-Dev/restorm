import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import './console.css'
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

/**
 * Symbol used to attach last-written-record bookkeeping directly
 * to the xterm `Terminal` instance. Stashing the state on the
 * Terminal itself means it lives and dies with the terminal
 * instance — a fresh terminal (after a tab move, StrictMode
 * remount, or close-and-reopen) has no prior state and the
 * records effect naturally takes the full-rewrite path. A React
 * useRef would persist across the dispose cycle and short-
 * circuit the rewrite for the empty new terminal.
 */
const TERM_LAST_WRITTEN_SYM = Symbol.for('restorm:console:lastWritten')

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
		// xterm.js reads `fontFamily` as a literal CSS string and
		// computes glyph metrics from it directly — it doesn't
		// expand `var(--…)`, so we have to resolve the workbench's
		// `--monospace-font` against the actual DOM before the
		// terminal mounts. Falls back to a per-platform stack
		// matching ECUI's `workbench.css` defaults.
		const resolved = getComputedStyle(node).getPropertyValue('--monospace-font').trim()
		const fontFamily = resolved !== ''
			? resolved
			: '"SF Mono", Menlo, Consolas, "Liberation Mono", "DejaVu Sans Mono", "Courier New", monospace'
		const term = new Terminal({
			disableStdin: true,
			fontFamily,
			fontSize: 13,
			lineHeight: 1.25,
			scrollback: 50_000,
			convertEol: true,
			// Cursor is hidden in this readonly console: the firewall
			// audit feed is a one-way stream, the user has no caret to
			// position. Setting `cursorBlink: false` only stops the
			// blink — the cursor still renders. Fully suppress it via
			// transparent `theme.cursor` + `theme.cursorAccent`,
			// belt-and-braces with `cursorInactiveStyle: 'none'` for
			// cases where the terminal loses focus.
			cursorBlink: false,
			cursorStyle: 'bar',
			cursorInactiveStyle: 'none',
			theme: {
				background: '#00000000',  // transparent — let the workbench bg show
				foreground: '#dadada',
				cursor: '#00000000',
				cursorAccent: '#00000000'
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

		// Ctrl+C / Cmd+C: copy the current xterm selection to the
		// system clipboard. Without this, the readonly terminal
		// captures the keystroke and nothing reaches the browser's
		// default copy path. We also forward Ctrl+A / Cmd+A so the
		// user can grab everything at once.
		term.attachCustomKeyEventHandler((event) => {
			if (event.type !== 'keydown') return true
			const mod = event.ctrlKey || event.metaKey
			if (mod && (event.key === 'c' || event.key === 'C')) {
				const selection = term.getSelection()
				if (selection.length > 0) {
					void navigator.clipboard.writeText(selection)
					event.preventDefault()
					return false
				}
			}
			if (mod && (event.key === 'a' || event.key === 'A')) {
				term.selectAll()
				event.preventDefault()
				return false
			}
			return true
		})

		// Block every non-left-button mouse interaction inside the
		// console. xterm's default handlers do two things we don't
		// want in a readonly audit feed:
		//   1. Right-click moves an internal "selection anchor" to
		//      the click row; the next drag-select then renders a
		//      stray pair of inverted cells where the right-click
		//      landed (they mirror the first chars of the next
		//      selection).
		//   2. Middle-click on Linux pastes the X11 PRIMARY
		//      selection into the buffer via `term.write()`, which
		//      `disableStdin` does NOT gate (it only blocks
		//      keyboard input, not programmatic writes).
		// We swallow on every event in the click lifecycle (down /
		// up / click / dblclick / auxclick / contextmenu) in
		// capture-phase so xterm's listeners never see them.
		const swallowMouse = (e: MouseEvent): void => {
			if (e.button === 1 || e.button === 2) {
				e.preventDefault()
				e.stopPropagation()
				e.stopImmediatePropagation()
			}
		}
		const swallowContextMenu = (e: MouseEvent): void => {
			e.preventDefault()
			e.stopPropagation()
		}
		node.addEventListener('contextmenu', swallowContextMenu, true)
		node.addEventListener('mousedown', swallowMouse, true)
		node.addEventListener('mouseup', swallowMouse, true)
		node.addEventListener('click', swallowMouse, true)
		node.addEventListener('dblclick', swallowMouse, true)
		node.addEventListener('auxclick', swallowMouse, true)

		const handleResize = (): void => {
			try { fit.fit() } catch { /* noop */ }
		}
		const ro = new ResizeObserver(handleResize)
		ro.observe(node)

		return () => {
			ro.disconnect()
			node.removeEventListener('contextmenu', swallowContextMenu, true)
			node.removeEventListener('mousedown', swallowMouse, true)
			node.removeEventListener('mouseup', swallowMouse, true)
			node.removeEventListener('click', swallowMouse, true)
			node.removeEventListener('dblclick', swallowMouse, true)
			node.removeEventListener('auxclick', swallowMouse, true)
			term.dispose()
			termRef.current = null
			fitRef.current = null
		}
	}, [])

	// Track the last-written record id + shell on the Terminal
	// INSTANCE (via a side-channel symbol property) instead of a
	// React useRef. Reason: when the Terminal is disposed (StrictMode
	// double-mount, tab move, panel re-parent), the next Terminal
	// instance is fresh and naturally has no per-term state — so the
	// records-effect re-runs the full-rewrite path against the new
	// terminal. A ref would persist across the dispose cycle and
	// short-circuit the rewrite for the new (empty) terminal,
	// leaving xterm visually empty under StrictMode.
	const TERM_LAST_WRITTEN_KEY = TERM_LAST_WRITTEN_SYM

	useEffect(() => {
		const term = termRef.current
		if (!term) return
		const termState = term as unknown as Record<symbol, { id: string | null; shell: ConsoleShell | null } | undefined>
		const cached = termState[TERM_LAST_WRITTEN_KEY] ?? { id: null, shell: null }
		const shellChanged = cached.shell !== shell
		const lastId = cached.id
		const lastIndexInNew = lastId !== null
			? records.findIndex((r) => r.id === lastId)
			: -1
		const canAppend = !shellChanged && lastIndexInNew !== -1

		if (!canAppend) {
			// Full rewrite: shell flipped, scrollback was cleared, or
			// the previously-emitted tail no longer lives in `records`
			// (clear or trim). Re-emit everything from scratch.
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
		} else {
			// Append-only path: only write records past the last-emitted id.
			let row = term.buffer.active.length
			for (let i = lastIndexInNew + 1; i < records.length; i += 1) {
				const record = records[i]
				if (!record) continue
				const block = buildBlock(record, shell)
				const lineCount = block.split('\r\n').length - 1
				rowToRecordId.current.set(row, record.id)
				row += lineCount
				term.write(block)
			}
		}
		const tail = records.length > 0 ? records[records.length - 1] : undefined
		termState[TERM_LAST_WRITTEN_KEY] = { id: tail?.id ?? null, shell }
		term.scrollToBottom()
	}, [records, shell, TERM_LAST_WRITTEN_KEY])

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
