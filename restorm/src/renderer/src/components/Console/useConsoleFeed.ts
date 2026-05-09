import { useEffect, useState } from 'react'
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
 * Every record is shown — origin (renderer / main) and protocol
 * (HTTP / GraphQL / gRPC / internal IPC bridge / …) all flow
 * through unfiltered. The console is the audit surface; if the
 * user is opening it, they want everything.
 */
export interface FirewallApi {
	onRecord(cb: (record: RequestRecord) => void): () => void
}

interface UseConsoleFeedOptions {
	bufferLimit?: number
}

export function useConsoleFeed(options: UseConsoleFeedOptions = {}): {
	records: RequestRecord[]
	clear: () => void
} {
	const { bufferLimit = 10_000 } = options
	const [records, setRecords] = useState<RequestRecord[]>([])

	useEffect(() => {
		const firewall = (window as unknown as { api?: { firewall?: FirewallApi } }).api?.firewall
		if (!firewall) return
		const off = firewall.onRecord((record) => {
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
