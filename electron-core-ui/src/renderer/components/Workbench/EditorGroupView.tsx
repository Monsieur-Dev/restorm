import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EditorTabs } from './EditorTabs';
import { Modal } from '../Modal';
import { useSetting } from '../../hooks/useSettings';
import type { EditorGroup, EditorWorkbenchCallbacks, SplitDirection } from './types';
import { getEditorDragData, isEditorDragEvent } from './dnd';
import { getTabTitleString } from './utils';
import { useIsWorkbenchResizing, computeTabDisplay } from './WorkbenchResizeContext';

/**
 * Hard-memoised slot for cached tab content. `tabContentCache` already
 * returns a stable React element ref per tab, and `<div key={tab.id}>`
 * wrappers stay in a stable DOM order, but wrapping the cached element
 * in a memoised passthrough pins the reconciler bailout: when
 * `content` is referentially identical, React does not re-enter the
 * inner subtree, and the embedded editors keep their fibers — and the
 * underlying Monaco / Milkdown instances — mounted.
 */
const CachedTabContentSlot = React.memo<{ content: React.ReactNode }>(
	({ content }) => <>{content}</>,
	(prev, next) => prev.content === next.content
);
CachedTabContentSlot.displayName = 'CachedTabContentSlot';

// Shared flex-fill style for the detached host node and the modal
// body mount point — both need to stretch to their parent so the
// embedded tab content lays out the same maximized as it does inline.
const FLEX_FILL_CSS_TEXT = 'display:flex; flex-direction:column; flex:1; min-height:0; min-width:0; width:100%; height:100%;';

/**
 * Renders a tab's content into a *stable detached host node* and then
 * physically relocates that node between the normal split-view slot
 * and the fullscreen modal body via `appendChild`.
 *
 * Why the detached host node: double-clicking a tab opens its content
 * "maximized" in a modal. Rendering the content a second time (a fresh
 * `renderTabContent` call) would mount a SEPARATE component instance —
 * the maximized view and the normal view would each have their own
 * React state, so an HTTP response, in-flight edits, etc. would not
 * survive the transition in either direction.
 *
 * Instead, the content is `createPortal`'d into a `<div>` host created
 * exactly once. That portal container never changes, so React never
 * remounts the content — it keeps the same fibers and the same state.
 * A `useLayoutEffect` just moves the host `<div>`'s DOM parent: into
 * the modal body while maximized, back into the normal slot otherwise.
 * Moving a DOM node with `appendChild` does not touch React's tree, so
 * no state is lost in either direction.
 *
 * `isMaximized` here is NOT `fullscreenTabId === tab.id` — it is
 * "this tab currently owns the modal body". The distinction matters
 * because the modal has a close animation: `fullscreenTabId` clears
 * the instant the user clicks close, but the modal body stays mounted
 * through the fade-out. Relocating on `fullscreenTabId` would yank the
 * content back into the normal slot mid-fade, leaving an empty modal
 * fading out. See `modalOwnerTabId` in `EditorGroupView`.
 */
const PortaledTabContent: React.FC<{
	content: React.ReactNode;
	isActive: boolean;
	isResizing: boolean;
	isMaximized: boolean;
	modalBody: HTMLElement | null;
}> = ({ content, isActive, isResizing, isMaximized, modalBody }) => {
	// Stable detached host node, created exactly once per instance via
	// a `useState` lazy initializer — the portal container never
	// changes, so React never remounts the content.
	const [host] = useState<HTMLDivElement>(() => {
		const node = document.createElement('div');
		node.style.cssText = FLEX_FILL_CSS_TEXT;
		return node;
	});
	const slotElRef = useRef<HTMLDivElement | null>(null);

	// Callback ref on the normal slot. Stable identity (`host` never
	// changes), so it fires only on mount / unmount — not on every
	// re-render. The mount-time `appendChild` runs during the commit's
	// layout phase, while the slot `<div>`'s ref attaches *before* the
	// portal content's own layout effects fire — which holds ONLY
	// because the slot `<div>` precedes the `createPortal(...)` in JSX
	// order below. Do NOT reorder them: that ordering is what lets
	// embedded editors (Monaco, etc.) mount with the host already in
	// the document and measure their size correctly first time.
	const slotRef = useCallback((el: HTMLDivElement | null) => {
		slotElRef.current = el;
		if (el && host.parentElement !== el) {
			el.appendChild(host);
		}
	}, [host]);

	// Relocate on maximize toggle: into the modal body while this tab
	// owns the modal, back into the normal slot otherwise. The content
	// is already mounted, so this is a pure DOM move — React's tree is
	// untouched, no remount, no state loss in either direction.
	useLayoutEffect(() => {
		const target = isMaximized ? modalBody : slotElRef.current;
		if (target && host.parentElement !== target) {
			target.appendChild(host);
		}
	}, [isMaximized, modalBody, host]);

	// On unmount (tab closed) the portal tears the React content down,
	// but the detached host `<div>` itself has no React owner — drop it
	// from whatever DOM parent it last sat in so it can be GC'd.
	useLayoutEffect(() => {
		return () => { host.remove(); };
	}, [host]);

	return (
		<>
			<div
				ref={slotRef}
				style={{
					display: isMaximized ? 'none' : computeTabDisplay(isActive, isResizing),
					flex: 1,
					minHeight: 0
				}}
			/>
			{createPortal(<CachedTabContentSlot content={content} />, host)}
		</>
	);
};
PortaledTabContent.displayName = 'PortaledTabContent';

export interface EditorGroupViewProps extends EditorWorkbenchCallbacks {
	group: EditorGroup;
	/**
	 * Whether this group currently has focus. Only one group should have focus at a time.
	 */
	hasFocus?: boolean;
	/**
	 * Callback to notify parent when this group should receive focus.
	 */
	onFocusRequested?: (groupId: string) => void;
	/**
	 * Workbench-wide id of the maximized tab (lifted to `EditorWorkbench`
	 * so it can be driven imperatively). This group opens its fullscreen
	 * modal only when this id names one of its own tabs.
	 */
	fullscreenTabId?: string | null;
	/**
	 * Set / clear the workbench-wide maximized tab id. Pass `null` to
	 * restore. Called on tab double-click and on modal close.
	 */
	onChangeFullscreenTabId?: (tabId: string | null) => void;
	/**
	 * Optional test id base for stable E2E selectors.
	 */
	'data-testid'?: string;
}

export const EditorGroupView: React.FC<EditorGroupViewProps> = (props) => {
	const { group, renderTabContent, onSplitTab, onActivateTab, hasFocus = false, onFocusRequested, fullscreenTabId = null, onChangeFullscreenTabId, 'data-testid': dataTestId } = props;
	const [splitTarget, setSplitTarget] = useState<SplitDirection | 'center' | undefined>(undefined);
	const [isEditorDrag, setIsEditorDrag] = useState<boolean>(false);
	// `fullscreenTabId` (a prop, owned by `EditorWorkbench`) drives the
	// modal's `isOpen` — it clears the instant the user clicks close, or
	// when an imperative `set_tab_maximized` restore lands. `modalOwnerTabId`
	// is "the tab whose content currently lives in the modal body": it is
	// adopted from `fullscreenTabId` and only cleared once the modal body
	// is truly gone (after the close animation). The two are deliberately
	// separate so the content stays parented to the fading modal instead
	// of being yanked back to the normal slot mid-animation.
	const [modalOwnerTabId, setModalOwnerTabId] = useState<string | null>(null);
	// DOM node of the fullscreen modal's body — a callback ref keeps
	// this in state so `PortaledTabContent` re-runs its relocation
	// effect the moment the modal mounts / unmounts its body.
	const [modalBody, setModalBody] = useState<HTMLDivElement | null>(null);
	const contentRef = useRef<HTMLDivElement | null>(null);
	const [advancedEffects] = useSetting('appearance:advancedVisualEffects');
	// Hide every tab body — including the active one — while a sash is
	// being dragged. Heavy embeds (Monaco, Electron `<webview>`,
	// ResizeObserver-driven charts) otherwise relayout on every
	// mousemove and visibly lag the drag. Module-level signal (not
	// React Context) — see WorkbenchResizeContext.tsx for why.
	const isResizing = useIsWorkbenchResizing();

	// Cache rendered tab contents — render each tab only once, then reuse.
	// This prevents React from unmounting/remounting heavy components (Monaco editors, etc.)
	// when switching tabs — only the CSS display property toggles visibility.
	// Using useState initializer as a persistent cache that survives re-renders.
	const [tabContentCache] = useState(() => new Map<string, React.ReactNode>());
	const [tabVersionCache] = useState(() => new Map<string, number>());

	const tabContents = useMemo(() => {
		// Prune entries for closed tabs
		const tabIds = new Set(group.tabs.map(t => t.id));
		for (const k of tabContentCache.keys()) {
			if (!tabIds.has(k)) {
				tabContentCache.delete(k);
				tabVersionCache.delete(k);
			}
		}
		// Render new tabs or tabs whose contentVersion changed, reuse cached content for others
		const result = new Map<string, React.ReactNode>();
		for (const tab of group.tabs) {
			const cachedVersion = tabVersionCache.get(tab.id);
			const currentVersion = tab.contentVersion ?? 0;
			let content = tabContentCache.get(tab.id);
			if (!content || cachedVersion !== currentVersion) {
				content = renderTabContent?.(tab) ?? tab.content ?? <span>{tab.title}</span>;
				tabContentCache.set(tab.id, content);
				tabVersionCache.set(tab.id, currentVersion);
			}
			result.set(tab.id, content);
		}
		return result;
	}, [group.tabs, renderTabContent, tabContentCache, tabVersionCache]);

	// Handle tab double-click for fullscreen modal. Only flips the lifted
	// `fullscreenTabId` — `modalOwnerTabId` is adopted from it during
	// render (see below), the same path the imperative `set_tab_maximized`
	// MCP tool takes.
	const handleTabDoubleClick = useCallback((tabId: string) => {
		const tab = group.tabs.find((t) => t.id === tabId);
		if (tab?.allowFullscreen) {
			onChangeFullscreenTabId?.(tabId);
		}
	}, [group.tabs, onChangeFullscreenTabId]);

	// Resolve the lifted `fullscreenTabId` against THIS group's tabs.
	// Only tabs that opted into `allowFullscreen` qualify, so an
	// imperative `set_tab_maximized` call can't maximize a tab the app
	// never marked maximizable.
	const fullscreenTab = useMemo(() => {
		if (!fullscreenTabId) return null;
		return group.tabs.find((t) => t.id === fullscreenTabId && t.allowFullscreen) ?? null;
	}, [fullscreenTabId, group.tabs]);

	// Adopt the resolved id into `modalOwnerTabId` during render (React's
	// "adjusting state while rendering" pattern). This is what makes the
	// imperative path work: `set_tab_maximized` only flips the
	// `fullscreenTabId` prop — it never runs `handleTabDoubleClick` — so
	// `modalOwnerTabId` would otherwise never catch up. We only ever
	// *adopt* here, never clear: releasing ownership stays the job of
	// `handleModalClosed` so the content lingers in the fading modal.
	if (fullscreenTab && modalOwnerTabId !== fullscreenTab.id) {
		setModalOwnerTabId(fullscreenTab.id);
	}

	// Fired by the Modal once its close animation has fully finished
	// (driven by the overlay's `transitionend`). This is the single
	// point where modal ownership is released: clearing `modalOwnerTabId`
	// only here keeps the maximized content parented to the fading modal
	// instead of snapping back to the normal slot mid-animation. It
	// deliberately does NOT touch the lifted `fullscreenTabId` prop — a
	// normal close already cleared it via `onClose`, and for an
	// externally-closed tab the id is left stale but inert (tab ids are
	// never reused, and no group resolves a missing tab). Leaving it
	// alone also means one split pane's close can never clobber a
	// maximize that meanwhile moved to another pane's tab. Using
	// `onClosed` (a real `transitionend`) rather than the modal body's
	// ref-detach keeps this robust against React StrictMode's
	// mount/unmount probing.
	const handleModalClosed = useCallback(() => {
		setModalOwnerTabId(null);
	}, []);

	// Wrapper around onActivateTab that also requests focus for this group
	const handleActivateTab = useCallback((tabId: string, groupId: string) => {
		// Request focus for this group when a tab is activated
		if (onFocusRequested) {
			onFocusRequested(groupId);
		}
		// Don't try to focus the content area programmatically - let Monaco or other editors handle their own focus
		// Call the original onActivateTab callback
		onActivateTab?.(tabId, groupId);
	}, [onActivateTab, onFocusRequested]);

	const computeDirection = useCallback((e: React.DragEvent<HTMLDivElement>): SplitDirection | 'center' => {
		const rect = e.currentTarget.getBoundingClientRect();
		const relX = (e.clientX - rect.left) / rect.width;
		const relY = (e.clientY - rect.top) / rect.height;
		const margin = 0.10; // 10% border zones
		if (relX < margin) return 'left';
		if (relX > 1 - margin) return 'right';
		if (relY < margin) return 'top';
		if (relY > 1 - margin) return 'bottom';
		return 'center';
	}, []);

	const overlayStyle = useMemo<React.CSSProperties>(() => {
		// Base overlay: fills container, does not block mouse, animates changes
		const base: React.CSSProperties = {
			position: 'absolute',
			inset: 0,
			zIndex: 10,
			// Only start intercepting events when an editor tab is being dragged
			pointerEvents: splitTarget && isEditorDrag ? 'auto' : 'none',
			backgroundColor: 'rgba(0, 0, 0, 0.40)',
			backdropFilter: advancedEffects ? 'blur(8px)' : undefined,
			transition: 'clip-path 150ms ease, opacity 120ms ease',
			willChange: 'clip-path, opacity',
			boxSizing: 'border-box',
			// Only show overlay when an editor tab is being dragged
			opacity: splitTarget && isEditorDrag ? 1 : 0
		};

		// Default/full area (center or undefined)
		if (!splitTarget || splitTarget === 'center') {
			return { ...base, clipPath: 'inset(0 0 0 0)' };
		}
		if (splitTarget === 'left') return { ...base, clipPath: 'inset(0 50% 0 0)' };
		if (splitTarget === 'right') return { ...base, clipPath: 'inset(0 0 0 50%)' };
		if (splitTarget === 'top') return { ...base, clipPath: 'inset(0 0 50% 0)' };
		// bottom
		return { ...base, clipPath: 'inset(50% 0 0 0)' };
	}, [splitTarget, isEditorDrag, advancedEffects]);

	const isBlockedDrop = useCallback((e: React.DragEvent<HTMLDivElement>): boolean => {
		const data = getEditorDragData(e);
		// Only consider drops coming from editor tab drag-and-drop
		if (!data) return false;
		// Block when dragging the only tab of this group over its own content
		return data.sourceGroupId === group.id &&
			group.tabs.length === 1 &&
			group.tabs[0]?.id === data.editorId;
	}, [group.id, group.tabs]);

	const onDragOverGroup = useCallback(
		(e: React.DragEvent<HTMLDivElement>) => {
			// Detect if current drag is coming from editor tabs (using MIME type or fallback flag)
			const isEditor = isEditorDragEvent(e);
			setIsEditorDrag(isEditor);
			if (!isEditor) {
				setSplitTarget(undefined);
				return;
			}
			e.preventDefault();
			if (isBlockedDrop(e)) {
				try { e.dataTransfer.dropEffect = 'none'; } catch { /* noop */ }
				setSplitTarget(undefined);
				return;
			}
			try { e.dataTransfer.dropEffect = 'move'; } catch { /* noop */ }
			setSplitTarget(computeDirection(e));
		},
		[computeDirection, isBlockedDrop]
	);

	const onDragEnterGroup = useCallback(
		(e: React.DragEvent<HTMLDivElement>) => {
			const isEditor = isEditorDragEvent(e);
			setIsEditorDrag(isEditor);
			if (!isEditor) {
				setSplitTarget(undefined);
				return;
			}
			e.preventDefault();
			if (isBlockedDrop(e)) {
				try { e.dataTransfer.dropEffect = 'none'; } catch { /* noop */ }
				setSplitTarget(undefined);
				return;
			}
			try { e.dataTransfer.dropEffect = 'move'; } catch { /* noop */ }
			setSplitTarget(computeDirection(e));
		},
		[computeDirection, isBlockedDrop]
	);

	const onDragLeaveGroup = useCallback(() => {
		setSplitTarget(undefined);
		setIsEditorDrag(false);
	}, []);

	const onDropGroup = useCallback(
		(e: React.DragEvent<HTMLDivElement>) => {
			const data = getEditorDragData(e);
			// Ignore drops that are not coming from editor tabs (e.g. Milkdown drag & drop)
			if (!data) {
				setSplitTarget(undefined);
				setIsEditorDrag(false);
				return;
			}
			e.preventDefault();
			// Ignore drop when dragging the only tab of this group into its own content
			if (data.sourceGroupId === group.id && group.tabs.length === 1 && group.tabs[0]?.id === data.editorId) {
				setSplitTarget(undefined);
				return;
			}
			const dir = computeDirection(e);
			setSplitTarget(undefined);
			const direction = dir === 'center' ? 'full' : dir;
			onSplitTab?.(data.editorId, data.sourceGroupId, group.id, direction);
			setIsEditorDrag(false);
		},
		[computeDirection, onSplitTab, group.id, group.tabs]
	);

	return (
		<div
			className="editor-group-container"
			data-group-id={group.id}
			data-has-focus={hasFocus ? 'true' : 'false'}
			{...(dataTestId && {
				'data-testid': `${dataTestId}-group-${group.id}`,
				'data-active-tab-id': group.activeTabId ?? '',
				'data-tab-count': String(group.tabs.length)
			})}
			style={{ display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative', height: '100%' }}
		>
			<div className="title" style={{ display: 'flex' }}>
				<EditorTabs
					{...props}
					onActivateTab={handleActivateTab}
					dimmed={!hasFocus}
					onTabDoubleClick={handleTabDoubleClick}
					{...(dataTestId && { 'data-testid': `${dataTestId}-group-${group.id}-tabs` })}
				/>
			</div>
			<div
				ref={contentRef}
				className="editor-group-content-placeholder"
				data-group-id={group.id}
				{...(dataTestId && {
					'data-testid': `${dataTestId}-group-${group.id}-content`,
					'data-split-target': (splitTarget ?? ''),
					'data-is-editor-drag': isEditorDrag ? 'true' : 'false'
				})}
				tabIndex={-1}
				onDragEnter={onDragEnterGroup}
				onDragOver={onDragOverGroup}
				onDragLeave={onDragLeaveGroup}
				onDrop={onDropGroup}
				onFocusCapture={() => {
					// When any element inside this container receives focus (including Monaco),
					// request focus for this group so tabs are not dimmed
					// But don't interfere with the actual focus - let Monaco keep its focus
					if (onFocusRequested) {
						onFocusRequested(group.id);
					}
					// Don't prevent default or stop propagation - let Monaco handle its own focus
				}}
				onMouseDown={(e) => {
					// Only request focus if clicking directly on the container itself (background),
					// not on interactive elements inside (like Monaco editor, inputs, textareas, etc.)
					// When clicking on interactive elements, onFocusCapture will handle it
					const target = e.target as HTMLElement;
					const isContainerClick = target === contentRef.current;

					// If clicking on the container itself (background), request focus
					// Monaco clicks will be handled by onFocusCapture when Monaco receives focus
					if (isContainerClick && onFocusRequested) {
						onFocusRequested(group.id);
					}
					// Don't prevent default or stop propagation - let Monaco and other editors handle their own clicks
				}}
				style={{
					position: 'relative',
					outline: 'none',
					overflow: 'hidden',
					flex: 1,
					minHeight: 0,
					display: 'flex',
					flexDirection: 'column'
				}}
			>
				<div className="editor-group-content-panel">
				{/*
				 * Render the content panes in a STABLE order keyed by
				 * `tab.id`, independent of the visual tab strip order
				 * managed by EditorTabs. When the user drags a tab, the
				 * tab strip reorders (via React's keyed reconciliation
				 * inside EditorTabs) but here, in the content panel, the
				 * `<div key={tab.id}>` host order does not change — only
				 * the `display` style flips between flex and none.
				 *
				 * Why this matters: when keyed children swap positions,
				 * React's reconciler marks the moved fiber for the
				 * `Placement` effect, which the commit phase translates
				 * into `parent.insertBefore(node, sibling)`. The DOM
				 * spec requires that step to *remove* the node from its
				 * current parent first and then re-insert at the new
				 * position. That brief detach is enough to break Monaco
				 * editors embedded inside (`InstantiationService has
				 * been disposed`, `domNode` access on a torn-down view).
				 * Sorting locally by tab id pins each pane's DOM
				 * position so a same-group reorder never moves any
				 * content-panel child.
				 *
				 * Each pane is a `PortaledTabContent`: it portals the
				 * cached content into a stable detached host node, so
				 * the double-click "maximize" modal can show the SAME
				 * component instance (same React state) rather than a
				 * freshly-mounted copy.
				 */}
				{[...group.tabs]
					.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
					.map((tab) => {
						const isActive = tab.id === group.activeTabId;
						const content = tabContents.get(tab.id);
						return (
							<PortaledTabContent
								key={tab.id}
								content={content}
								isActive={isActive}
								isResizing={isResizing}
								isMaximized={modalOwnerTabId === tab.id}
								modalBody={modalBody}
							/>
						);
					})}
				</div>
				<div
					style={overlayStyle}
					{...(dataTestId && { 'data-testid': `${dataTestId}-group-${group.id}-overlay` })}
					onDragEnter={(e) => {
						onDragEnterGroup(e);
						e.stopPropagation();
					}}
					onDragOver={(e) => {
						onDragOverGroup(e);
						e.stopPropagation();
					}}
					onDragLeave={(e) => {
						onDragLeaveGroup();
						e.stopPropagation();
					}}
					onDrop={(e) => {
						onDropGroup(e);
						e.stopPropagation();
					}}
				/>
			</div>
			<Modal
				isOpen={fullscreenTab !== null}
				onClose={() => {
					onChangeFullscreenTabId?.(null);
				}}
				onClosed={handleModalClosed}
				title={fullscreenTab?.fullscreenModalTitle ?? (fullscreenTab ? getTabTitleString(fullscreenTab, '') : '')}
			>
				{/*
				 * Empty mount point. `PortaledTabContent` relocates the
				 * maximized tab's host node into this div via
				 * `appendChild` — no `renderTabContent` call here, so the
				 * maximized view shares the normal view's instance + state.
				 */}
				<div
					ref={setModalBody}
					style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, width: '100%', height: '100%' }}
				/>
			</Modal>
		</div>
	);
};

export default EditorGroupView;
