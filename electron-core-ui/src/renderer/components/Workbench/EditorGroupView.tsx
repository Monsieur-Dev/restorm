import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorTabs } from './EditorTabs';
import { useSetting } from '../../hooks/useSettings';
import type { EditorGroup, EditorWorkbenchCallbacks, SplitDirection } from './types';
import { getEditorDragData, isEditorDragEvent } from './dnd';
import { useIsWorkbenchResizing } from './WorkbenchResizeContext';
import { TabSlot } from './TabContentHost';

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
	 * Flip the workbench-wide maximized tab id. Pass `null` to restore.
	 * Called on tab double-click; the fullscreen modal itself lives in
	 * `EditorWorkbench`.
	 */
	onChangeFullscreenTabId?: (tabId: string | null) => void;
	/**
	 * Workbench-wide id of the maximized tab (the modal-owner state).
	 * A `TabSlot` whose tab matches relocates its host node into the
	 * modal body and renders `display:none` so it doesn't occupy layout
	 * space behind the modal.
	 */
	maximizedTabId?: string | null;
	/**
	 * The fullscreen modal's body DOM node (owned by `EditorWorkbench`).
	 * `TabSlot` relocates the maximized tab's host node into it.
	 */
	modalBody?: HTMLElement | null;
	/**
	 * Returns the stable, workbench-owned host `<div>` for a tab id.
	 * `TabSlot` relocates it into this group's slot on mount, so a tab's
	 * React subtree survives being moved between groups.
	 */
	getTabHost: (tabId: string) => HTMLDivElement;
	/**
	 * Optional test id base for stable E2E selectors.
	 */
	'data-testid'?: string;
}

export const EditorGroupView: React.FC<EditorGroupViewProps> = (props) => {
	const {
		group, onSplitTab, onActivateTab, hasFocus = false, onFocusRequested,
		onChangeFullscreenTabId, maximizedTabId = null, modalBody = null,
		getTabHost,
		'data-testid': dataTestId
	} = props;
	const [splitTarget, setSplitTarget] = useState<SplitDirection | 'center' | undefined>(undefined);
	const [isEditorDrag, setIsEditorDrag] = useState<boolean>(false);
	const contentRef = useRef<HTMLDivElement | null>(null);
	const [advancedEffects] = useSetting('appearance:advancedVisualEffects');
	// Hide every tab body — including the active one — while a sash is
	// being dragged. Heavy embeds (Monaco, Electron `<webview>`,
	// ResizeObserver-driven charts) otherwise relayout on every
	// mousemove and visibly lag the drag. Module-level signal (not
	// React Context) — see WorkbenchResizeContext.tsx for why.
	const isResizing = useIsWorkbenchResizing();

	// Open the fullscreen modal on tab double-click. Only flips the
	// workbench-wide id — the modal and the tab content both live in
	// `EditorWorkbench` now; the `allowFullscreen` gate keeps a
	// non-maximizable tab from opening one.
	const handleTabDoubleClick = useCallback((tabId: string) => {
		const tab = group.tabs.find((t) => t.id === tabId);
		if (tab?.allowFullscreen) {
			onChangeFullscreenTabId?.(tabId);
		}
	}, [group.tabs, onChangeFullscreenTabId]);

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

	// Direction is measured against the group's content placeholder
	// (`contentRef`), NOT `e.currentTarget`: the drag handlers are now
	// attached as native DOM listeners on that placeholder (see the
	// effect below), so a `dragover` bubbling up from the portalled tab
	// content reports `currentTarget` as the placeholder anyway — but
	// reading the ref directly keeps it correct regardless of which
	// descendant the event actually fired on.
	const computeDirection = useCallback((e: DragEvent): SplitDirection | 'center' => {
		const host = contentRef.current;
		if (!host) return 'center';
		const rect = host.getBoundingClientRect();
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

	const isBlockedDrop = useCallback((e: DragEvent): boolean => {
		const data = getEditorDragData(e);
		// Only consider drops coming from editor tab drag-and-drop
		if (!data) return false;
		// Block when dragging the only tab of this group over its own content
		return data.sourceGroupId === group.id &&
			group.tabs.length === 1 &&
			group.tabs[0]?.id === data.editorId;
	}, [group.id, group.tabs]);

	const onDragOverGroup = useCallback(
		(e: DragEvent) => {
			// Detect if current drag is coming from editor tabs (using MIME type or fallback flag)
			const isEditor = isEditorDragEvent(e);
			setIsEditorDrag(isEditor);
			if (!isEditor) {
				setSplitTarget(undefined);
				return;
			}
			e.preventDefault();
			if (isBlockedDrop(e)) {
				if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
				setSplitTarget(undefined);
				return;
			}
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
			setSplitTarget(computeDirection(e));
		},
		[computeDirection, isBlockedDrop]
	);

	const onDragEnterGroup = useCallback(
		(e: DragEvent) => {
			const isEditor = isEditorDragEvent(e);
			setIsEditorDrag(isEditor);
			if (!isEditor) {
				setSplitTarget(undefined);
				return;
			}
			e.preventDefault();
			if (isBlockedDrop(e)) {
				if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
				setSplitTarget(undefined);
				return;
			}
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
			setSplitTarget(computeDirection(e));
		},
		[computeDirection, isBlockedDrop]
	);

	const onDragLeaveGroup = useCallback((e: DragEvent) => {
		// `dragleave` also fires when the pointer crosses between this
		// group's own descendants — most notably the split overlay's
		// `clip-path` boundary, since a clipped element does not
		// hit-test its clipped-away region. Only tear the overlay down
		// when the pointer has actually moved to something OUTSIDE the
		// group container; an intra-group move keeps it up.
		const next = e.relatedTarget;
		if (next instanceof Node && contentRef.current?.contains(next)) return;
		setSplitTarget(undefined);
		setIsEditorDrag(false);
	}, []);

	const onDropGroup = useCallback(
		(e: DragEvent) => {
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

	// Attach the split-drop drag handlers as NATIVE DOM listeners on the
	// content placeholder rather than React `onDrag*` props. The tab
	// content is `createPortal`'d with `EditorWorkbench` as its React
	// parent, so React's synthetic drag events on the content propagate
	// to `EditorWorkbench` and never reach this group's handlers. DOM
	// bubbling, by contrast, follows the real DOM tree — and the host
	// node IS a DOM descendant of this placeholder — so a `dragover`
	// fired anywhere over the group reaches these listeners.
	useEffect(() => {
		const el = contentRef.current;
		if (!el) return undefined;
		el.addEventListener('dragenter', onDragEnterGroup);
		el.addEventListener('dragover', onDragOverGroup);
		el.addEventListener('dragleave', onDragLeaveGroup);
		el.addEventListener('drop', onDropGroup);
		return () => {
			el.removeEventListener('dragenter', onDragEnterGroup);
			el.removeEventListener('dragover', onDragOverGroup);
			el.removeEventListener('dragleave', onDragLeaveGroup);
			el.removeEventListener('drop', onDropGroup);
		};
	}, [onDragEnterGroup, onDragOverGroup, onDragLeaveGroup, onDropGroup]);

	// Same portal-side-effect as above: clicking *anywhere* in a tab's
	// content should make this group the active one (the tab header
	// lights up). React's synthetic mousedown / focus events on the
	// portalled content bubble through the React tree to
	// `EditorWorkbench`, so a React `onMouseDown` / `onFocusCapture` on
	// this placeholder never sees clicks inside Monaco / the body / the
	// Send button / etc. Native DOM bubbling DOES reach the placeholder
	// (the host node is a real DOM descendant), so we use
	// `addEventListener('mousedown' | 'focusin', …)` instead.
	//
	// `focusin` (bubbling counterpart of `focus`) covers programmatic
	// focus moves — e.g. Tab-key navigation into Monaco, or `.focus()`
	// from a component — that don't go through `mousedown`.
	useEffect(() => {
		const el = contentRef.current;
		if (!el || !onFocusRequested) return undefined;
		const handleActivate = (): void => { onFocusRequested(group.id); };
		el.addEventListener('mousedown', handleActivate);
		el.addEventListener('focusin', handleActivate);
		return () => {
			el.removeEventListener('mousedown', handleActivate);
			el.removeEventListener('focusin', handleActivate);
		};
	}, [onFocusRequested, group.id]);

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
			style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, position: 'relative', height: '100%' }}
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
				/*
				 * Split-drop drag handlers AND the activate-group click /
				 * focus listeners are attached as native DOM listeners on
				 * this node (see the two `useEffect`s above) — NOT as
				 * React props — because the tab content is `createPortal`'d
				 * with `EditorWorkbench` as its React parent, so synthetic
				 * events bubble up the React tree to the workbench rather
				 * than to this group.
				 */
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
				 * One empty `TabSlot` per tab, rendered in a STABLE order
				 * keyed by `tab.id` — independent of the visual tab-strip
				 * order managed by EditorTabs. The tab *content* is not
				 * rendered here: each `TabSlot` only registers its `<div>`
				 * with `EditorWorkbench`, which relocates the tab's
				 * workbench-owned host node into it. Moving a tab between
				 * groups (or in/out of the fullscreen modal) is then a
				 * pure `appendChild` of that host node — React never
				 * unmounts the tab's subtree, so its state survives.
				 *
				 * The stable id-sorted order matters because swapping
				 * keyed children marks the moved fiber for a `Placement`
				 * effect, whose `insertBefore` briefly detaches the node —
				 * enough to break embedded Monaco editors. Pinning each
				 * slot's DOM position by tab id means a same-group reorder
				 * never moves any slot.
				 */}
				{[...group.tabs]
					.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
					.map((tab) => (
						<TabSlot
							key={tab.id}
							tabId={tab.id}
							isActive={tab.id === group.activeTabId}
							isResizing={isResizing}
							isMaximized={maximizedTabId === tab.id}
							modalBody={modalBody}
							getTabHost={getTabHost}
						/>
					))}
				</div>
				{/*
				 * Visual-only split indicator. Drag handling lives on
				 * the content placeholder's native DOM listeners — this
				 * overlay carries no `onDrag*` props: its `clip-path`
				 * would otherwise drop hit-testing for the clipped-away
				 * half, firing a spurious `dragleave` the instant the
				 * pointer crossed the boundary.
				 */}
				<div
					style={overlayStyle}
					{...(dataTestId && { 'data-testid': `${dataTestId}-group-${group.id}-overlay` })}
				/>
			</div>
		</div>
	);
};

export default EditorGroupView;
