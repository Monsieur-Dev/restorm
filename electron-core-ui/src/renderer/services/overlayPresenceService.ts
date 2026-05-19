/**
 * Tracks the **currently-mounted set of HTML overlays** that paint
 * above the rest of the renderer (popovers, tooltips, toasters,
 * modals, search dropdowns, …). Consumers register themselves when
 * their portal mounts and unregister on unmount. The service exposes
 * a subscribe API that fires on every register / unregister so
 * listeners can take whatever measure they need — the load-bearing
 * one being `MiniBrowserPanel`, which has to collapse its main-process
 * `WebContentsView` whenever an overlay would otherwise be hidden
 * underneath it (the view paints at the OS compositor layer, above
 * every HTML pixel).
 *
 * Rects are read lazily through a callback: `getRect()` is invoked
 * by listeners when they need a fresh measurement. Storing a callback
 * (rather than a frozen DOMRect) means a tooltip that re-positions
 * itself after mount automatically exposes the up-to-date geometry
 * without re-registering — the listener just calls `getRect()` again
 * the next time it cares.
 */

export interface OverlayPresence {
	/** Stable id of this overlay for the lifetime of its registration.
	 * Listeners use it to dedupe; consumers can use it to update if
	 * they need to re-register, though usually unregister + register
	 * is simpler. */
	readonly id: string
	/** Snapshot of the overlay's current bounding rect. Called every
	 * time a listener needs the geometry — kept callback-based rather
	 * than stored-DOMRect so an overlay that animates / repositions
	 * doesn't need to push updates after every frame. Returns `null`
	 * if the underlying element has gone (e.g. the consumer ref
	 * cleared between notify and read). */
	getRect: () => DOMRect | null
}

type OverlayListener = (overlays: readonly OverlayPresence[]) => void

class OverlayPresenceService {
	private overlays = new Map<string, OverlayPresence>()
	private listeners = new Set<OverlayListener>()
	private nextId = 0

	/** Register a new overlay. Returns the assigned id; pass it to
	 * `unregister` when the overlay is gone. Listeners are notified
	 * synchronously after the entry is added. */
	register(getRect: () => DOMRect | null): string {
		const id = `overlay-${++this.nextId}`
		this.overlays.set(id, { id, getRect })
		this.notify()
		return id
	}

	/** Remove an overlay by its id. No-op for unknown ids so callers
	 * can hold an Optional / cleared id without checking first. */
	unregister(id: string): void {
		if (this.overlays.delete(id)) this.notify()
	}

	/** Subscribe to overlay-set changes. The listener fires once
	 * synchronously with the current snapshot — same shape as
	 * `Observable.subscribe` in other libraries — so first-mount
	 * consumers don't need a separate "read current state" call.
	 * Returns an unsubscribe fn. */
	subscribe(listener: OverlayListener): () => void {
		this.listeners.add(listener)
		listener(this.snapshot())
		return () => { this.listeners.delete(listener) }
	}

	/** Synchronous snapshot of every currently-registered overlay.
	 * Useful for tests and for any consumer that needs a one-shot
	 * read without subscribing. */
	snapshot(): readonly OverlayPresence[] {
		return Array.from(this.overlays.values())
	}

	private notify(): void {
		const snapshot = this.snapshot()
		for (const listener of this.listeners) listener(snapshot)
	}
}

/** Singleton — the renderer process has at most one of these. */
export const overlayPresenceService = new OverlayPresenceService()
