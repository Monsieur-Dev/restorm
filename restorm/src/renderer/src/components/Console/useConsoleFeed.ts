import { useCallback, useSyncExternalStore } from 'react'
import type { RequestRecord } from '../../../../shared/types/firewall'

/**
 * Renderer-side firewall feed buffer. Module-level singleton so
 * the records survive across Console-tab remounts: dragging the
 * tab between workbench groups (or any other reparenting) tears
 * down + recreates the xterm component, but `Console.tsx` reads
 * its scrollback from this store on every render — meaning a
 * fresh mount immediately re-paints the entire history rather
 * than starting empty.
 *
 * The store also subscribes to `window.api.firewall.onRecord`
 * eagerly (the first time anyone calls `useConsoleFeed`) so the
 * audit log keeps filling even when no Console tab is open. The
 * buffer cap (10 000 records) bounds memory; oldest drop off the
 * front when exceeded. `clear()` empties everything and notifies
 * the (single) `useConsoleFeed` consumer to re-render.
 *
 * One firewall subscription, one buffer, many subscribers — the
 * pattern matches React's `useSyncExternalStore` contract so
 * concurrent rendering stays consistent.
 */
export interface FirewallApi {
	onRecord(cb: (record: RequestRecord) => void): () => void
}

const BUFFER_LIMIT = 10_000

class ConsoleFeedStore {
	// Mutable internal buffer — we never expose this directly, only
	// versioned snapshots cloned in `flush()`. Push + occasional trim
	// keep the per-record cost O(1) instead of O(n) array copies on
	// every firewall event (which under sustained traffic was
	// triggering long-task warnings in DevTools — render thrash from
	// re-cloning a 10 000-element array per record).
	private buffer: RequestRecord[] = []
	private snapshot: RequestRecord[] = []
	private listeners = new Set<() => void>()
	private firewallUnsub: (() => void) | null = null
	// rAF-batching: coalesce all records that land within a single
	// animation frame into one snapshot bump + one notify pass.
	// Keeps the renderer at one re-render per frame even when a
	// burst of subresource loads slams the firewall pipe.
	private flushHandle: number | null = null

	getSnapshot = (): RequestRecord[] => this.snapshot

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener)
		this.ensureFirewallSubscription()
		return () => { this.listeners.delete(listener) }
	}

	clear = (): void => {
		if (this.buffer.length === 0 && this.snapshot.length === 0) return
		this.buffer = []
		this.snapshot = []
		this.notify()
	}

	private ensureFirewallSubscription(): void {
		if (this.firewallUnsub !== null) return
		const firewall = (window as unknown as { api?: { firewall?: FirewallApi } }).api?.firewall
		if (!firewall) return
		this.firewallUnsub = firewall.onRecord((record) => { this.append(record) })
	}

	private append(record: RequestRecord): void {
		this.buffer.push(record)
		// Trim only when materially over the cap (BUFFER_LIMIT * 1.1)
		// so we amortise the splice-cost over many records instead
		// of paying O(n) on every push past the limit.
		const overshoot = this.buffer.length - BUFFER_LIMIT
		if (overshoot > BUFFER_LIMIT * 0.1) {
			this.buffer.splice(0, overshoot)
		}
		this.scheduleFlush()
	}

	private scheduleFlush(): void {
		if (this.flushHandle !== null) return
		this.flushHandle = requestAnimationFrame(() => {
			this.flushHandle = null
			this.flush()
		})
	}

	private flush(): void {
		// Trim down to the strict cap before snapshotting so
		// consumers never see beyond `BUFFER_LIMIT` records, even
		// during the hysteresis window where `append` left the
		// buffer slightly oversize.
		if (this.buffer.length > BUFFER_LIMIT) {
			this.buffer.splice(0, this.buffer.length - BUFFER_LIMIT)
		}
		this.snapshot = this.buffer.slice()
		this.notify()
	}

	private notify(): void {
		for (const listener of this.listeners) listener()
	}
}

// Pin the store to `globalThis` so HMR (which re-evaluates this
// module) doesn't drop the records buffer. Without the pin, every
// HMR pass creates a fresh `ConsoleFeedStore` and the new store
// starts empty — meaning a Vite hot-update for any file in the
// Console tree wipes the user's accumulated audit feed mid-session.
// In production there's no HMR, so the singleton lives for the
// lifetime of the renderer regardless. The bracket-key avoids the
// type acrobatics of declaring a property on `globalThis`.
const STORE_GLOBAL_KEY = '__restormConsoleFeedStore__'
const globalRef = globalThis as unknown as Record<string, ConsoleFeedStore | undefined>
const store: ConsoleFeedStore = globalRef[STORE_GLOBAL_KEY] ?? (globalRef[STORE_GLOBAL_KEY] = new ConsoleFeedStore())

export function useConsoleFeed(): {
	records: RequestRecord[]
	clear: () => void
} {
	const records = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
	const clear = useCallback(() => { store.clear() }, [])
	return { records, clear }
}

/**
 * Imperative escape hatch: wipe the singleton store from outside a
 * component. Used by the MCP `console_clear` bridge in `App.tsx`
 * where there's no `useConsoleFeed()` call site to hold the hook's
 * `clear` over — the IPC handler needs a stable reference it can
 * invoke from anywhere.
 */
export function clearConsoleFeed(): void {
	store.clear()
}
