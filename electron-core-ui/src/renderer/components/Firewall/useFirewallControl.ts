import { useCallback, useSyncExternalStore } from 'react'
import type { FirewallOrigin, SystemEndpointStatus } from '../../../types/firewall'

/**
 * Renderer-side mutator hook for the firewall control plane. Reads
 * the main-process state through `window.api.firewall.*` IPC calls
 * and exposes mutators that round-trip through the same channel.
 *
 * State lives main-side in `PermissionService` (whitelist +
 * blacklist persisted to `userData/firewall/state.json`; project-
 * derived origins recomputed on every project change). The
 * renderer mirrors a snapshot via `useSyncExternalStore` so
 * multiple `<FirewallPanel />` instances stay consistent and the
 * `react-hooks/set-state-in-effect` lint rule doesn't fire.
 */
interface FirewallControlApi {
	listWhitelist: () => Promise<FirewallOrigin[]>
	addToWhitelist: (origin: FirewallOrigin) => Promise<void>
	removeFromWhitelist: (origin: FirewallOrigin) => Promise<void>
	listBlacklist: () => Promise<FirewallOrigin[]>
	addToBlacklist: (origin: FirewallOrigin) => Promise<void>
	removeFromBlacklist: (origin: FirewallOrigin) => Promise<void>
	/** Read-only: the app's own outbound destinations. Optional so a host app
	 * that hasn't wired the channel yet degrades to an empty list rather than
	 * throwing. */
	listSystemEndpoints?: () => Promise<SystemEndpointStatus[]>
	/** Main → renderer push fired when the outbound inventory moves. Optional
	 * for the same reason; without it the list is simply not live. */
	onSystemEndpointsChanged?: (cb: () => void) => () => void
}

function getFirewallApi(): FirewallControlApi | null {
	const api = (window as unknown as { api?: { firewall?: FirewallControlApi } }).api?.firewall
	return api ?? null
}

interface FirewallSnapshot {
	whitelist: FirewallOrigin[]
	blacklist: FirewallOrigin[]
	systemEndpoints: SystemEndpointStatus[]
	ready: boolean
}

class FirewallControlStore {
	private snapshot: FirewallSnapshot = { whitelist: [], blacklist: [], systemEndpoints: [], ready: false }
	private listeners = new Set<() => void>()
	private fetchInFlight: Promise<void> | null = null
	/** Set when a change lands while a fetch is already running; drives one
	 * more read after it settles. */
	private rerunQueued = false

	getSnapshot = (): FirewallSnapshot => this.snapshot

	/** Detaches the main→renderer push subscription; held while at least one
	 * component is mounted. */
	private offEndpointsChanged: (() => void) | null = null

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener)
		// Attach the outbound-inventory push once, on the first mount: consent
		// is granted or revoked in Preferences, not here, so without it an open
		// panel would keep showing a stale exemption state.
		this.offEndpointsChanged ??= getFirewallApi()?.onSystemEndpointsChanged?.(() => { void this.refresh() }) ?? null
		void this.refresh()
		return () => {
			this.listeners.delete(listener)
			if (this.listeners.size === 0) {
				this.offEndpointsChanged?.()
				this.offEndpointsChanged = null
			}
		}
	}

	refresh = async (): Promise<void> => {
		// Coalesce, but never DROP: a change that lands mid-fetch schedules one
		// more read once the current one settles. Without the re-run flag a
		// consent revocation racing the mount fetch would leave the panel
		// showing the pre-revocation state until the next remount.
		if (this.fetchInFlight !== null) {
			this.rerunQueued = true
			return this.fetchInFlight
		}
		const api = getFirewallApi()
		if (api === null) return
		this.fetchInFlight = (async () => {
			try {
				const [whitelist, blacklist, systemEndpoints] = await Promise.all([
					api.listWhitelist(),
					api.listBlacklist(),
					api.listSystemEndpoints?.() ?? Promise.resolve<SystemEndpointStatus[]>([])
				])
				this.snapshot = { whitelist, blacklist, systemEndpoints, ready: true }
				this.notify()
			} finally {
				this.fetchInFlight = null
			}
			if (this.rerunQueued) {
				this.rerunQueued = false
				await this.refresh()
			}
		})()
		return this.fetchInFlight
	}

	private notify(): void {
		for (const listener of this.listeners) listener()
	}
}

const STORE_GLOBAL_KEY = '__ecuiFirewallControlStore__'
const globalRef = globalThis as unknown as Record<string, FirewallControlStore | undefined>
const store: FirewallControlStore = globalRef[STORE_GLOBAL_KEY] ?? (globalRef[STORE_GLOBAL_KEY] = new FirewallControlStore())

/**
 * Force-refresh the global firewall snapshot. Called by the toast
 * hook after a prompt resolution so the panel picks up the new
 * whitelist / blacklist entry without waiting for the next mount
 * or user-driven add. Pure side-effect call — usable from any
 * module without a React context.
 */
export async function refreshFirewallControl(): Promise<void> {
	await store.refresh()
}

interface UseFirewallControlResult {
	whitelist: FirewallOrigin[]
	blacklist: FirewallOrigin[]
	/** The app's own outbound destinations — read-only, no mutator counterpart. */
	systemEndpoints: SystemEndpointStatus[]
	ready: boolean
	addToWhitelist: (origin: FirewallOrigin) => Promise<void>
	removeFromWhitelist: (origin: FirewallOrigin) => Promise<void>
	addToBlacklist: (origin: FirewallOrigin) => Promise<void>
	removeFromBlacklist: (origin: FirewallOrigin) => Promise<void>
	refresh: () => Promise<void>
}

export function useFirewallControl(): UseFirewallControlResult {
	const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

	const addToWhitelist = useCallback(async (origin: FirewallOrigin): Promise<void> => {
		const api = getFirewallApi()
		if (api === null) return
		await api.addToWhitelist(origin)
		await store.refresh()
	}, [])

	const removeFromWhitelist = useCallback(async (origin: FirewallOrigin): Promise<void> => {
		const api = getFirewallApi()
		if (api === null) return
		await api.removeFromWhitelist(origin)
		await store.refresh()
	}, [])

	const addToBlacklist = useCallback(async (origin: FirewallOrigin): Promise<void> => {
		const api = getFirewallApi()
		if (api === null) return
		await api.addToBlacklist(origin)
		await store.refresh()
	}, [])

	const removeFromBlacklist = useCallback(async (origin: FirewallOrigin): Promise<void> => {
		const api = getFirewallApi()
		if (api === null) return
		await api.removeFromBlacklist(origin)
		await store.refresh()
	}, [])

	const refresh = useCallback(async (): Promise<void> => {
		await store.refresh()
	}, [])

	return {
		whitelist: snapshot.whitelist,
		blacklist: snapshot.blacklist,
		systemEndpoints: snapshot.systemEndpoints,
		ready: snapshot.ready,
		addToWhitelist,
		removeFromWhitelist,
		addToBlacklist,
		removeFromBlacklist,
		refresh
	}
}
