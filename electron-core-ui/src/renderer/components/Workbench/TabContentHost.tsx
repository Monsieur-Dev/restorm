import React, { useCallback, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { computeTabDisplay } from './WorkbenchResizeContext';

// `useLayoutEffect` is used by `TabSlot` below; `TabContentHost` itself
// must stay effect-free — see the comment on it.

/**
 * Shared flex-fill style for a tab's detached host node. It must stretch
 * to whatever parent currently holds it — a split-pane slot, another
 * group's slot, or the fullscreen modal body — so the embedded tab
 * content lays out identically in every location.
 */
export const FLEX_FILL_CSS_TEXT =
	'display:flex; flex-direction:column; flex:1; min-height:0; min-width:0; width:100%; height:100%;';

/**
 * Hard-memoised passthrough for cached tab content. The content element
 * is referentially stable per tab (the workbench's content cache), so
 * pinning the reconciler bailout here keeps the embedded editors'
 * fibers — and the underlying Monaco / Milkdown instances — mounted.
 */
const CachedTabContentSlot = React.memo<{ content: React.ReactNode }>(
	({ content }) => <>{content}</>,
	(prev, next) => prev.content === next.content
);
CachedTabContentSlot.displayName = 'CachedTabContentSlot';

/**
 * Workbench-level owner of one tab's rendered content.
 *
 * The content is `createPortal`'d into a `<div>` host node that is
 * created and owned by `EditorWorkbench` (NOT by any `EditorGroupView`).
 * Because both the host node and this portal live *above* the split-pane
 * tree, the tab's React subtree survives every relocation — moved
 * between groups, maximized into the modal, restored — with only the
 * host `<div>`'s DOM parent changing via `appendChild`. `appendChild`
 * never touches React's tree, so an HTTP response, in-flight edits,
 * scroll position, etc. are all preserved.
 *
 * **This component is deliberately effect-free.** It does NOT relocate
 * the host (that is `TabSlot`'s job) and it does NOT drop the host node
 * on unmount. A cleanup effect that did `host.remove()` would fire
 * during React StrictMode's mount-time simulated unmount and detach the
 * host node with nothing re-attaching it — a blank tab in dev. Host
 * nodes are GC'd instead by `EditorWorkbench`'s `tabContents` memo,
 * which prunes (`host.remove()` + map delete) every host whose tab has
 * left the tree — the single, StrictMode-safe owner of that cleanup.
 */
export const TabContentHost: React.FC<{
	host: HTMLDivElement;
	content: React.ReactNode;
}> = ({ host, content }) => {
	return createPortal(<CachedTabContentSlot content={content} />, host);
};
TabContentHost.displayName = 'TabContentHost';

/**
 * Group-level slot for one tab — and the *single owner* of that tab's
 * host-node placement while the tab lives in this group.
 *
 * It renders an empty `<div>` (the slot) and relocates the tab's
 * workbench-owned host node into it: into this slot in the normal case,
 * into `modalBody` while the tab is maximized. Because the slot ref and
 * the relocation effect both live in the `EditorGroupView` that
 * currently holds the tab, `slotElRef.current` is *this group's own*
 * slot — set synchronously by this component's own ref callback, so it
 * can never be a stale reference to a group the tab has since left.
 *
 * Cross-group move: the old group's `TabSlot` unmounts and the new
 * group's `TabSlot` mounts; the new one's ref callback `appendChild`s
 * the host into the new slot. The host node — and therefore the tab's
 * whole React subtree — is only ever *moved*, never remounted.
 *
 * The slot owns only the visibility toggle (`display`) — active vs
 * inactive vs maximized vs sash-resize — never the content itself.
 *
 * Slots are rendered in a STABLE order keyed by `tab.id` (the caller
 * sorts), independent of the visual tab-strip order: when keyed
 * children swap positions React marks the moved fiber for a `Placement`
 * effect, and the resulting `insertBefore` briefly detaches the node —
 * enough to break embedded Monaco editors. Pinning each slot's DOM
 * position by tab id means a same-group reorder never moves any slot.
 */
export const TabSlot: React.FC<{
	tabId: string;
	isActive: boolean;
	isResizing: boolean;
	isMaximized: boolean;
	modalBody: HTMLElement | null;
	getTabHost: (tabId: string) => HTMLDivElement;
}> = ({ tabId, isActive, isResizing, isMaximized, modalBody, getTabHost }) => {
	const slotElRef = useRef<HTMLDivElement | null>(null);
	// `isMaximized` captured at mount into a ref so the slot ref callback
	// can stay referentially stable (it must fire only on real slot
	// mount / unmount, not on every maximize toggle). The callback only
	// ever *reads* this ref when it fires with a non-null element — i.e.
	// at mount — so the `useRef` initializer alone keeps it correct;
	// later maximize toggles are handled by the relocation effect below,
	// not by re-running the ref callback.
	const isMaximizedAtMountRef = useRef(isMaximized);

	// Slot ref — stable. On mount, eagerly relocate the host into this
	// slot UNLESS the tab is maximized (then its host belongs to the
	// modal). The eager placement runs before the portal content's own
	// layout effects, so embedded editors (Monaco, …) measure their size
	// with the host already in the document.
	const slotRef = useCallback((el: HTMLDivElement | null) => {
		slotElRef.current = el;
		if (el && !isMaximizedAtMountRef.current) {
			const host = getTabHost(tabId);
			if (host.parentElement !== el) {
				el.appendChild(host);
			}
		}
	}, [tabId, getTabHost]);

	// Relocate on maximize toggle: into the modal body while this tab is
	// maximized, back into this group's slot otherwise. Idempotent
	// (`host.parentElement !== target` guard) so it composes safely with
	// the eager placement in `slotRef` regardless of commit ordering.
	useLayoutEffect(() => {
		const host = getTabHost(tabId);
		const target = isMaximized ? modalBody : slotElRef.current;
		if (target && host.parentElement !== target) {
			target.appendChild(host);
		}
	}, [tabId, isMaximized, modalBody, getTabHost]);

	return (
		<div
			ref={slotRef}
			style={{
				display: isMaximized ? 'none' : computeTabDisplay(isActive, isResizing),
				flex: 1,
				minHeight: 0
			}}
		/>
	);
};
TabSlot.displayName = 'TabSlot';
