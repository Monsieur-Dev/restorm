import { useEffect, type RefObject } from 'react'
import { overlayPresenceService } from '../services/overlayPresenceService'

/**
 * Register the overlay rendered inside `ref` with the global
 * `overlayPresenceService` for the duration it is `active`. Drop
 * the registration on unmount, on `active = false`, or on ref
 * teardown. Consumers are the components that render a portalled
 * overlay (Modal, Tooltip, Toaster, SelectBox dropdown, …) and want
 * the `MiniBrowserPanel` to know to collapse its content view while
 * the overlay is on-screen.
 *
 * `ref` is read lazily from inside the service's `getRect()` callback,
 * so re-positions after registration are reflected without
 * re-registering — the listener simply re-invokes `getRect()` next
 * time it needs the geometry.
 *
 * @param ref     React ref of the DOM element whose bounding rect
 *                represents the overlay's footprint. The element
 *                does NOT need to be a flow-layout child of the
 *                portal — for `position: fixed` / `absolute` portals
 *                the element's own bounding rect is the right one.
 * @param active  Set false to skip the registration (e.g. while the
 *                overlay is hidden). Defaults to true.
 */
export function useOverlayPresence(ref: RefObject<HTMLElement | null>, active = true): void {
	useEffect(() => {
		if (!active) return
		const id = overlayPresenceService.register(() => ref.current?.getBoundingClientRect() ?? null)
		return () => { overlayPresenceService.unregister(id) }
	}, [ref, active])
}
