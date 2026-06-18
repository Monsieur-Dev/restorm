import { useCallback, useSyncExternalStore } from 'react'
import type { FirewallOrigin } from '../../../types/firewall'

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
}

function getFirewallApi(): FirewallControlApi | null {
	const api = (window as unknown as { api?: { firewall?: FirewallControlApi } }).api?.firewall
	return api ?? null
}

interface FirewallSnapshot {
	whitelist: FirewallOrigin[]
	blacklist: FirewallOrigin[]
	ready: boolean
}

class FirewallControlStore {
	private snapshot: FirewallSnapshot = { whitelist: [], blacklist: [], ready: false }
	private listeners = new Set<() => void>()
	private fetchInFlight: Promise<void> | null = null

	getSnapshot = (): FirewallSnapshot => this.snapshot

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener)
		void this.refresh()
		return () => { this.listeners.delete(listener) }
	}

	refresh = async (): Promise<void> => {
		if (this.fetchInFlight !== null) return this.fetchInFlight
		const api = getFirewallApi()
		if (api === null) return
		this.fetchInFlight = (async () => {
			try {
				const [whitelist, blacklist] = await Promise.all([api.listWhitelist(), api.listBlacklist()])
				this.snapshot = { whitelist, blacklist, ready: true }
				this.notify()
			} finally {
				this.fetchInFlight = null
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
		ready: snapshot.ready,
		addToWhitelist,
		removeFromWhitelist,
		addToBlacklist,
		removeFromBlacklist,
		refresh
	}
}
