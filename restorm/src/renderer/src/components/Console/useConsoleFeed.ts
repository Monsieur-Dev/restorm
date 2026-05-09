import { useEffect, useRef, useState } from 'react'
import type { RequestRecord } from '../../../../shared/types/firewall'

/**
 * Renderer-side subscription to the firewall's `RequestRecord`
 * broadcast (`window.api.firewall.onRecord`). Keeps a rolling
 * buffer in component state and exposes a `clear()` action wired
 * to the toolbar's clear button.
 *
 * Buffer cap defaults to 10 000 records — enough for a long demo
 * session without dragging the renderer into multi-MB territory.
 * Older records drop off the front when the cap is exceeded.
 *
 * Internal Restorm calls (renderer ↔ main IPC GraphQL bridge) are
 * tagged `protocol: 'internal'` at emission and filtered here by
 * default; passing `showInternal=true` un-hides them for power
 * users who want to audit the full firewall feed.
 */
export interface FirewallApi {
	onRecord(cb: (record: RequestRecord) => void): () => void
}

interface UseConsoleFeedOptions {
	bufferLimit?: number
	showInternal?: boolean
}

export function useConsoleFeed(options: UseConsoleFeedOptions = {}): {
	records: RequestRecord[]
	clear: () => void
} {
	const { bufferLimit = 10_000, showInternal = false } = options
	const [records, setRecords] = useState<RequestRecord[]>([])
	// Track the latest-known showInternal value via a ref so the
	// listener installed on mount can read it without re-binding
	// every time the prop flips.
	const showInternalRef = useRef(showInternal)
	useEffect(() => { showInternalRef.current = showInternal }, [showInternal])

	useEffect(() => {
		const firewall = (window as unknown as { api?: { firewall?: FirewallApi } }).api?.firewall
		if (!firewall) return
		const off = firewall.onRecord((record) => {
			if (record.protocol === 'internal' && !showInternalRef.current) return
			setRecords((prev) => {
				const next = prev.length >= bufferLimit
					? [...prev.slice(prev.length - bufferLimit + 1), record]
					: [...prev, record]
				return next
			})
		})
		return off
	}, [bufferLimit])

	const clear = (): void => { setRecords([]) }
	return { records, clear }
}
