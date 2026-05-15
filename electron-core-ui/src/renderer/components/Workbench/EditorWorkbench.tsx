import React, { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, forwardRef } from 'react';
import type { ContainerGroupNode, EditorGroup, EditorTab, EditorWorkbenchCallbacks, GroupNode, SplitDirection, WorkbenchTree } from './types';
import { isContainerNode, isTabGroupNode } from './types';
import { EditorGroupView } from './EditorGroupView';
import { cloneTree, collectActiveTabIds, flattenTabs, insertTabAt, moveTabToAdjacentGroup, normalizeTree, removeTab } from './tree';
import { TabContentHost, FLEX_FILL_CSS_TEXT } from './TabContentHost';
import { Modal } from '../Modal';
import { getTabTitleString } from './utils';
import { computeDropIndex } from './dnd';
import { getCurrentWindowBounds } from './ipc';
import { onWorkbenchTabDropped } from './ipc';
import { logger } from '../../services/logger';
import { Sash } from '../Sash';
import type { SashEvent, IVerticalSashLayoutProvider, IHorizontalSashLayoutProvider } from '../Sash';
import { saveWorkbenchState, loadWorkbenchState, clearWorkbenchState, rebuildWorkbenchTree } from './persistence';
import type { RebuildTabCallback } from './persistence';
import { setWorkbenchResizing } from './WorkbenchResizeContext';
import './styles/tabs.css';

export interface EditorWorkbenchProps extends EditorWorkbenchCallbacks {
	tree: WorkbenchTree;
	onChange?: (tree: WorkbenchTree) => void;
	style?: React.CSSProperties;
	className?: string;
	'data-testid'?: string;
	/**
	 * Optional controlled focused group ID. When provided, focus visuals will follow this value.
	 * When omitted, the workbench manages focus internally.
	 */
	focusedGroupId?: string | null | undefined;
	/**
	 * Called whenever the focused group changes, either due to tab activation or editor focus.
	 */
	onFocusedGroupChange?: ((groupId: string | null) => void) | undefined;
	/**
	 * Optional fallback component to display when no tabs are open.
	 * If not provided, nothing is displayed.
	 */
	emptyFallback?: React.ReactNode;
	/**
	 * Called when group sizes change (due to sash dragging).
	 * The nodeId is 'root' for top-level groups, or the container node ID for nested groups.
	 */
	onSizesChange?: ((nodeId: string, sizes: number[]) => void) | undefined;
	/**
	 * Unique identifier for this workbench instance (used for persistence).
	 * Required if autosave is enabled.
	 */
	workbenchId?: string;
	/**
	 * Enable automatic saving/loading of workbench state.
	 * When enabled, the workbench will automatically save its state on changes
	 * and attempt to restore it on mount.
	 * Requires workbenchId to be set.
	 */
	autosave?: boolean;
	/**
	 * Callback to rebuild a tab from its persisted ID.
	 * Required if autosave is enabled.
	 * Should return the EditorTab or null if the tab cannot be rebuilt.
	 */
	onRebuildTab?: RebuildTabCallback;
	/**
	 * Called when the workbench state has been restored from storage.
	 * Receives the restored tree or null if restoration failed.
	 */
	onStateRestored?: (tree: WorkbenchTree | null) => void;
}

/**
 * Imperative handle for EditorWorkbench
 */
export interface EditorWorkbenchHandle {
	/**
	 * Manually save the current workbench state to storage.
	 * @returns true if save was successful
	 */
	saveState: () => Promise<boolean>;
	/**
	 * Manually load and restore workbench state from storage.
	 * @returns The restored tree or null if restoration failed
	 */
	loadState: () => Promise<WorkbenchTree | null>;
	/**
	 * Clear the persisted workbench state from storage.
	 * @returns true if clear was successful
	 */
	clearState: () => Promise<boolean>;
	/**
	 * Maximize (open fullscreen) a workbench tab by id, or restore the
	 * currently-maximized tab by passing `null`. Mirrors what a
	 * double-click on the tab does — same `allowFullscreen` gate, same
	 * fullscreen modal. Drives the workbench-wide `fullscreenTabId`.
	 */
	setFullscreenTabId: (tabId: string | null) => void;
}

// Local splitter hook for any container
function useSplitSizes(
	count: number,
	isVertical: boolean,
	containerRef: React.RefObject<HTMLDivElement | null>,
	initialSizes?: number[],
	onSizesChange?: (sizes: number[]) => void
): { sizes: number[]; onSashStart: (index: number) => (event: SashEvent) => void; onSashChange: (index: number) => (event: SashEvent) => void } {
	// Track user-set sizes with the count they were computed for, and the initialSizes that were applied
	const [sizeState, setSizeState] = useState<{ forCount: number; values: number[]; appliedInitial: string | null }>({ forCount: 0, values: [], appliedInitial: null });
	const minGroupPx = 120;
	const startSizesRef = useRef<number[]>([]);
	const startCoordRef = useRef<number>(0);
	const axisSizeRef = useRef<number>(0);
	const currentIndexRef = useRef<number>(-1);
	const onSizesChangeRef = useRef(onSizesChange);
	useLayoutEffect(() => {
		onSizesChangeRef.current = onSizesChange;
	}, [onSizesChange]);

	// Create a stable key for initialSizes to track if they've been applied
	const initialSizesKey = initialSizes ? initialSizes.join(',') : null;

	// Derive sizes from state, initialSizes, or compute equal distribution
	const sizes = useMemo(() => {
		if (count <= 0) return [];
		// If user has set sizes for current count, use them
		if (sizeState.forCount === count && sizeState.values.length === count) {
			return sizeState.values;
		}
		// If initial sizes match count and haven't been applied yet, use them
		if (initialSizes?.length === count && initialSizesKey !== sizeState.appliedInitial) {
			return initialSizes;
		}
		// Otherwise compute equal distribution
		const equal = 1 / count;
		return new Array<number>(count).fill(equal);
	}, [count, sizeState, initialSizes, initialSizesKey]);

	// Apply initialSizes using requestAnimationFrame to avoid synchronous setState in effect
	useEffect(() => {
		if (initialSizes?.length === count && initialSizesKey !== sizeState.appliedInitial) {
			const rafId = requestAnimationFrame(() => {
				setSizeState({ forCount: count, values: initialSizes, appliedInitial: initialSizesKey });
			});
			return (): void => { cancelAnimationFrame(rafId); };
		}
		return undefined;
	}, [count, initialSizes, initialSizesKey, sizeState.appliedInitial]);

	// Wrapper to set sizes while tracking count
	const setSizes = useCallback((updater: number[] | ((prev: number[]) => number[])) => {
		setSizeState(prev => {
			const newValues = typeof updater === 'function' ? updater(prev.values) : updater;
			return { forCount: count, values: newValues, appliedInitial: prev.appliedInitial };
		});
	}, [count]);

	const onSashStart = useCallback((index: number) => {
		return (event: SashEvent): void => {
			if (!containerRef.current || sizes.length !== count) {
				return;
			}
			const rect = containerRef.current.getBoundingClientRect();
			const axisSize = isVertical ? Math.max(1, rect.width) : Math.max(1, rect.height);
			const startCoord = isVertical ? event.startX - rect.left : event.startY - rect.top;
			
			axisSizeRef.current = axisSize;
			startCoordRef.current = startCoord;
			startSizesRef.current = [...sizes];
			currentIndexRef.current = index;
		};
	}, [sizes, count, isVertical, containerRef]);

	const onSashChange = useCallback((index: number) => {
		return (event: SashEvent): void => {
			if (index < 0 || index + 1 >= startSizesRef.current.length || !containerRef.current) return;
			
			const rect = containerRef.current.getBoundingClientRect();
			const currentCoord = isVertical ? event.currentX - rect.left : event.currentY - rect.top;
			const deltaPx = currentCoord - startCoordRef.current;
			const delta = deltaPx / axisSizeRef.current;
			const minPercent = Math.min(0.5, minGroupPx / axisSizeRef.current);
			
			let left = (startSizesRef.current[index] ?? 0) + delta;
			let right = (startSizesRef.current[index + 1] ?? 0) - delta;
			if (left < minPercent) {
				right -= (minPercent - left);
				left = minPercent;
			}
			if (right < minPercent) {
				left -= (minPercent - right);
				right = minPercent;
			}
			const next = [...startSizesRef.current];
			const li = index;
			const ri = index + 1;
			let leftVal = Math.max(minPercent, Math.min(1 - minPercent, left));
			let rightVal = Math.max(minPercent, Math.min(1 - minPercent, right));
			next[li] = leftVal;
			next[ri] = rightVal;
			// keep others as-is but renormalize the pair to preserve total
			const sumOthers = startSizesRef.current.reduce((acc, s, i) => (i === li || i === ri ? acc : acc + s), 0);
			const sumNext = leftVal + rightVal + sumOthers;
			if (sumNext !== 1) {
				const scale = (1 - sumOthers) / (leftVal + rightVal);
				leftVal *= scale;
				rightVal *= scale;
				next[li] = leftVal;
				next[ri] = rightVal;
			}
			setSizes(next);
		// Notify parent of size change
		onSizesChangeRef.current?.(next);
		};
	}, [isVertical, containerRef, setSizes]);

	return { sizes, onSashStart, onSashChange };
}

const GroupContainer: React.FC<{
	node: ContainerGroupNode;
	callbacks: EditorWorkbenchCallbacks;
	renderLeaf: (node: EditorGroup) => React.ReactNode;
	onNodeSizesChange?: ((nodeId: string, sizes: number[]) => void) | undefined;
	dataTestIdBase?: string;
}> = ({ node, callbacks, renderLeaf, onNodeSizesChange, dataTestIdBase }) => {
	const isVertical = node.orientation === 'vertical';
	const ref = useRef<HTMLDivElement | null>(null);

	const handleSizesChange = useCallback((newSizes: number[]) => {
		onNodeSizesChange?.(node.id, newSizes);
	}, [node.id, onNodeSizesChange]);

	const { sizes, onSashStart, onSashChange } = useSplitSizes(
		node.groups.length,
		isVertical,
		ref,
		node.sizes,
		handleSizesChange
	);

	// Wrappers around the internal sash handlers that also flip the
	// workbench-wide resize flag (module singleton — see
	// WorkbenchResizeContext.tsx for why this is NOT a Context.Provider).
	// Tab bodies subscribe via `useIsWorkbenchResizing` and switch to
	// `display: none` for the duration, skipping per-mousemove layout
	// for every heavy embed. Wired on the Sash's `onStart`/`onEnd` props.
	const handleSashStart = useCallback((index: number) => {
		return (event: SashEvent): void => {
			setWorkbenchResizing(true);
			onSashStart(index)(event);
		};
	}, [onSashStart]);

	const handleSashEnd = useCallback((): void => {
		setWorkbenchResizing(false);
	}, []);

	// Create layout provider for each sash
	const createLayoutProvider = useCallback((index: number): IVerticalSashLayoutProvider | IHorizontalSashLayoutProvider => {
		if (isVertical) {
			return {
				getVerticalSashLeft: (_sash: { orientation: 'vertical' | 'horizontal' }): number => {
					if (!ref.current) return 0;
					const rect = ref.current.getBoundingClientRect();
					let left = 0;
					for (let i = 0; i <= index; i++) {
						left += (sizes[i] ?? 0) * rect.width;
					}
					return left;
				},
				getVerticalSashTop: (): number => {
					if (!ref.current) return 0;
					return 0;
				},
				getVerticalSashHeight: (): number => {
					if (!ref.current) return 0;
					const rect = ref.current.getBoundingClientRect();
					return rect.height;
				}
			};
		} else {
			return {
				getHorizontalSashTop: (_sash: { orientation: 'vertical' | 'horizontal' }): number => {
					if (!ref.current) return 0;
					const rect = ref.current.getBoundingClientRect();
					let top = 0;
					for (let i = 0; i <= index; i++) {
						top += (sizes[i] ?? 0) * rect.height;
					}
					return top;
				},
				getHorizontalSashLeft: (): number => {
					if (!ref.current) return 0;
					return 0;
				},
				getHorizontalSashWidth: (): number => {
					if (!ref.current) return 0;
					const rect = ref.current.getBoundingClientRect();
					return rect.width;
				}
			};
		}
	}, [isVertical, sizes]);

	return (
		<div
			ref={ref}
			{...(dataTestIdBase && { 'data-testid': `${dataTestIdBase}-container-${node.id}`, 'data-orientation': node.orientation, 'data-child-count': String(node.groups.length) })}
			style={{ display: 'flex', flex: 1, flexDirection: isVertical ? 'row' : 'column', minWidth: 0, minHeight: 0, position: 'relative' }}
		>
			{node.groups.map((child, i) => (
				<React.Fragment key={child.id}>
					<div
						{...(dataTestIdBase && {
							'data-testid': isTabGroupNode(child)
								? `${dataTestIdBase}-slot-group-${child.id}`
								: `${dataTestIdBase}-slot-container-${child.id}`
						})}
						style={{
							display: 'flex',
							flexDirection: 'column',
							...(isVertical
								? { flex: `0 0 ${(sizes[i] ?? 0) * 100}%`, minWidth: 0 }
								: { flex: '0 0 auto', height: `${(sizes[i] ?? 0) * 100}%`, minHeight: 0 })
						}}
					>
						{isTabGroupNode(child)
							? renderLeaf(child)
							: (
								<GroupContainer
									node={child}
									callbacks={callbacks}
									renderLeaf={renderLeaf}
									onNodeSizesChange={onNodeSizesChange}
									{...(dataTestIdBase && { dataTestIdBase })}
								/>
							)}
					</div>
					{i < node.groups.length - 1 ? (
						<Sash
							orientation={isVertical ? 'vertical' : 'horizontal'}
							layoutProvider={createLayoutProvider(i)}
							onStart={handleSashStart(i)}
							onChange={onSashChange(i)}
							onEnd={handleSashEnd}
							state="enabled"
							{...(dataTestIdBase && { 'data-testid': `${dataTestIdBase}-sash-${node.id}-${i}` })}
						/>
					) : null}
				</React.Fragment>
			))}
		</div>
	);
};

/**
 * EditorWorkbench (tree-based): renders nested editor groups and handles split logic.
 * Consumers own and mutate `tree` (controlled) or pass `onChange` to get updates.
 * Supports automatic persistence when autosave and workbenchId are provided.
 */
export const EditorWorkbench = forwardRef<EditorWorkbenchHandle, EditorWorkbenchProps>(({
	tree,
	className,
	style,
	onChange,
	focusedGroupId,
	onFocusedGroupChange,
	onActivateTab: externalOnActivateTab,
	emptyFallback,
	onSizesChange,
	workbenchId,
	autosave,
	onRebuildTab,
	onStateRestored,
	'data-testid': dataTestId,
	...extCallbacks
}, ref) => {
	// Internal focus state when component is uncontrolled
	const [internalFocusedGroupId, setInternalFocusedGroupId] = useState<string | null>(null);

	// Which tab is currently maximized (fullscreen modal), workbench-wide
	// — at most one across all split-pane groups. Lifted here so it can
	// be driven imperatively via the handle, e.g. by the
	// `set_tab_maximized` MCP tool.
	const [fullscreenTabId, setFullscreenTabId] = useState<string | null>(null);
	// `modalOwnerTabId` is "the tab whose content currently lives in the
	// modal body": adopted from `fullscreenTabId`, but only released once
	// the modal's close animation has finished — so the content stays
	// parented to the fading modal instead of snapping back to its slot
	// mid-animation. `modalBody` is the modal's body DOM node, kept in
	// state so the relocation re-runs the moment the modal mounts it.
	const [modalOwnerTabId, setModalOwnerTabId] = useState<string | null>(null);
	const [modalBody, setModalBody] = useState<HTMLDivElement | null>(null);

	// ─── Workbench-wide tab content ownership ───────────────────────
	// Tab content is rendered ONCE here, above the split-pane tree, into
	// a per-tab detached host `<div>`. Each `EditorGroupView` only
	// provides an empty `TabSlot`, which relocates the host node into
	// itself (or into the modal body, while maximized). This is what
	// lets a tab move between groups — or in/out of the fullscreen
	// modal — without React ever unmounting its subtree, so an HTTP
	// response / in-flight edits survive the move.

	// Stable per-tab host nodes. A ref (not state): the map is mutated
	// in place and never drives a re-render on its own.
	const hostNodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
	const getTabHost = useCallback((tabId: string): HTMLDivElement => {
		let host = hostNodesRef.current.get(tabId);
		if (!host) {
			host = document.createElement('div');
			host.style.cssText = FLEX_FILL_CSS_TEXT;
			// Stable per-tab marker — survives every relocation (group ↔
			// group, slot ↔ modal) because the node itself is only ever
			// moved, never recreated. Handy for debugging and a precise
			// E2E hook for "the tab kept its single instance".
			host.setAttribute('data-tab-host-id', tabId);
			hostNodesRef.current.set(tabId, host);
		}
		return host;
	}, []);

	// Render-cache: render each tab's content once, reuse the same React
	// element until its `contentVersion` bumps. Same intent as the
	// previous per-`EditorGroupView` cache, lifted to cover every tab in
	// the tree regardless of which group holds it.
	const [tabContentCache] = useState(() => new Map<string, React.ReactNode>());
	const [tabVersionCache] = useState(() => new Map<string, number>());

	const allTabs = useMemo(() => flattenTabs(tree), [tree]);

	// Lazy-mount policy: a tab is materialised (its React subtree
	// mounted via the `TabContentHost` portal) the first time it appears
	// as a group's `activeTabId` — i.e. the first time it would be
	// visible to the user. It stays mounted thereafter, so subsequent
	// switches back to it are instant and any state (response, scroll,
	// editor selection) survives. Tabs that have never been visible —
	// e.g. siblings of the active tab, or extras opened in the
	// background by an MCP tree-replace — pay zero React cost until the
	// user actually activates them. `fullscreenTabId` is added too so
	// imperative `set_tab_maximized` mounts an unvisited tab.
	//
	// The "newly-active" check is done DURING RENDER (not in a
	// `useEffect`) so the same render that flipped a slot's display to
	// `flex` also commits its portal — otherwise the user would see one
	// frame of empty tab content before the effect fired. Calling
	// `setState` during render is a supported React pattern as long as
	// it's gated by a comparison.
	const [mountedTabIds, setMountedTabIds] = useState<Set<string>>(
		() => new Set([...collectActiveTabIds(tree), ...(fullscreenTabId ? [fullscreenTabId] : [])])
	);
	const newlyActiveTabIds = [...collectActiveTabIds(tree), ...(fullscreenTabId ? [fullscreenTabId] : [])]
		.filter((id) => !mountedTabIds.has(id));
	if (newlyActiveTabIds.length > 0) {
		setMountedTabIds((prev) => {
			// StrictMode replays the setter — re-check membership against
			// `prev` (not the stale closure `mountedTabIds`) and bail out
			// with the same reference when there's nothing new to add, so
			// React doesn't schedule an extra render on the replay.
			let changed = false;
			const next = new Set(prev);
			for (const id of newlyActiveTabIds) {
				if (!next.has(id)) {
					next.add(id);
					changed = true;
				}
			}
			return changed ? next : prev;
		});
	}

	// Stable id-sorted order for rendering the `TabContentHost` portals.
	// Rendering them in tree order would let a tab REORDER (within a
	// group, or a cross-group move) shuffle the `<TabContentHost>`
	// siblings — and React's `Placement` move of a portal-bearing fiber
	// disconnects + reconnects that subtree's passive effects, which
	// re-runs `@monaco-editor/react`'s mount effect against an already-
	// disposed editor ("InstantiationService has been disposed" /
	// "reading 'domNode'"). An id-keyed sort pins each portal's sibling
	// position so no reorder ever moves one. (Mirrors the same id-sort
	// `EditorGroupView` applies to its `TabSlot`s.)
	const orderedTabs = useMemo(
		() => [...allTabs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
		[allTabs]
	);

	// Hoist to a stable local so the content memo can depend on the
	// callback itself rather than on the per-render `extCallbacks` rest
	// object (which would defeat the memo).
	const renderTabContent = extCallbacks.renderTabContent;

	// This memo mutates `tabContentCache` / `tabVersionCache` /
	// `hostNodesRef` as a side effect (a render-cache write + a prune of
	// closed tabs). React StrictMode double-invokes `useMemo`, so EVERY
	// mutation here MUST stay idempotent across a repeated call: cache
	// writes are keyed + version-guarded, prunes are membership-guarded,
	// and `host.remove()` is a no-op on an already-detached node. Keep
	// it that way — a non-idempotent mutation would misbehave under the
	// double-invoke.
	const tabContents = useMemo(() => {
		const tabIds = new Set(allTabs.map((t) => t.id));
		// Prune caches + host nodes for tabs that left the tree (closed).
		for (const k of tabContentCache.keys()) {
			if (!tabIds.has(k)) {
				tabContentCache.delete(k);
				tabVersionCache.delete(k);
			}
		}
		for (const k of [...hostNodesRef.current.keys()]) {
			if (!tabIds.has(k)) {
				hostNodesRef.current.get(k)?.remove();
				hostNodesRef.current.delete(k);
			}
		}
		const result = new Map<string, React.ReactNode>();
		for (const tab of allTabs) {
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
	}, [allTabs, renderTabContent, tabContentCache, tabVersionCache]);

	// Resolve `fullscreenTabId` against the whole tree. Only tabs that
	// opted into `allowFullscreen` qualify, so an imperative
	// `set_tab_maximized` call can't maximize a tab the app never marked
	// maximizable.
	const fullscreenTab = useMemo(() => {
		if (!fullscreenTabId) return null;
		return allTabs.find((t) => t.id === fullscreenTabId && t.allowFullscreen) ?? null;
	}, [fullscreenTabId, allTabs]);

	// Adopt the resolved id into `modalOwnerTabId` during render (React's
	// "adjusting state while rendering" pattern). We only ever *adopt*
	// here, never clear: releasing ownership is `handleModalClosed`'s
	// job, so the content lingers in the fading modal.
	if (fullscreenTab && modalOwnerTabId !== fullscreenTab.id) {
		setModalOwnerTabId(fullscreenTab.id);
	}

	// Fired by the Modal once its close animation has fully finished.
	// Single point where modal ownership is released — keeps the
	// maximized content parented to the fading modal instead of snapping
	// back to its slot mid-animation. Does NOT touch `fullscreenTabId`:
	// a normal close already cleared it via `onClose`, and an
	// externally-closed tab leaves an inert stale id (tab ids are never
	// reused). Driven by `onClosed` (a real `transitionend`) so it is
	// robust against React StrictMode's mount/unmount probing.
	const handleModalClosed = useCallback(() => {
		setModalOwnerTabId(null);
	}, []);

	// Track if workbench state has been restored
	const restoredRef = useRef(false);

	const testId = dataTestId ?? 'editorworkbench';
	const effectiveFocusedGroupId = focusedGroupId ?? internalFocusedGroupId;
	
	// Store latest tree for imperative methods
	const treeRef = useRef(tree);
	treeRef.current = tree;
	
	// Store latest onRebuildTab for imperative methods
	const onRebuildTabRef = useRef(onRebuildTab);
	onRebuildTabRef.current = onRebuildTab;
	
	// Imperative handle: saveState, loadState, clearState
	const saveStateImpl = useCallback(async (): Promise<boolean> => {
		if (!workbenchId) {
			logger.warn('[EditorWorkbench] Cannot save state: workbenchId is not set');
			return false;
		}
		return saveWorkbenchState(workbenchId, treeRef.current);
	}, [workbenchId]);
	
	const loadStateImpl = useCallback(async (): Promise<WorkbenchTree | null> => {
		if (!workbenchId) {
			logger.warn('[EditorWorkbench] Cannot load state: workbenchId is not set');
			return null;
		}
		if (!onRebuildTabRef.current) {
			logger.warn('[EditorWorkbench] Cannot load state: onRebuildTab is not set');
			return null;
		}
		const savedState = await loadWorkbenchState(workbenchId);
		if (!savedState) {
			return null;
		}
		return rebuildWorkbenchTree(savedState, onRebuildTabRef.current);
	}, [workbenchId]);
	
	const clearStateImpl = useCallback(async (): Promise<boolean> => {
		if (!workbenchId) {
			logger.warn('[EditorWorkbench] Cannot clear state: workbenchId is not set');
			return false;
		}
		return clearWorkbenchState(workbenchId);
	}, [workbenchId]);
	
	useImperativeHandle(ref, () => ({
		saveState: saveStateImpl,
		loadState: loadStateImpl,
		clearState: clearStateImpl,
		setFullscreenTabId
	}), [saveStateImpl, loadStateImpl, clearStateImpl]);
	
	// Tracks whether the initial restore (if any) has completed. The
	// autosave writer below gates on this flag so the empty default tree
	// at mount doesn't clobber the persisted state before `loadState` has
	// had a chance to run.
	const restoreCompleteRef = useRef(false);

	// Autosave: restore state on mount
	useEffect(() => {
		if (!autosave || !workbenchId || !onRebuildTab || restoredRef.current) {
			return;
		}
		restoredRef.current = true;

		const restore = async (): Promise<void> => {
			const restoredTree = await loadStateImpl();
			if (restoredTree && onChange) {
				onChange(restoredTree);
			}
			onStateRestored?.(restoredTree);
			restoreCompleteRef.current = true;
		};
		void restore();
	}, [autosave, workbenchId, onRebuildTab, loadStateImpl, onChange, onStateRestored]);

	// Autosave: save state on tree changes. When the tree becomes empty
	// (the user closed every tab) we clear the persisted state instead of
	// calling `saveWorkbenchState` — otherwise the previously-saved tab
	// stays in storage and gets resurrected the next time the file is
	// reopened.
	useEffect(() => {
		if (!autosave || !workbenchId) {
			return;
		}
		// Wait until the initial restore has had a chance to run before we
		// start overwriting storage — otherwise the empty default tree at
		// mount wipes the persisted state.
		if (!restoreCompleteRef.current) {
			return;
		}
		if (tree.groups.length === 0) {
			void clearWorkbenchState(workbenchId);
		} else {
			void saveWorkbenchState(workbenchId, tree);
		}
	}, [autosave, workbenchId, tree]);

	// Helper to update focus in controlled/uncontrolled modes and notify parent
	const setFocus = useCallback(
		(groupId: string | null) => {
			if (onFocusedGroupChange) {
				onFocusedGroupChange(groupId);
			}
			// Only update local state when not controlled
			if (focusedGroupId === undefined) {
				setInternalFocusedGroupId(groupId);
			}
		},
		[focusedGroupId, onFocusedGroupChange]
	);

	// Track activeTabIds to detect external tree changes (e.g. sidebar click opening a tab).
	// When a group's activeTabId changes externally, auto-focus that group visually
	// without moving the DOM focus (sidebar keeps focus).
	const prevActiveTabIdsRef = useRef<Map<string, string | undefined>>(new Map());
	// Set by the Ctrl+Alt+Arrow handler to mark the next tree change as
	// "explicitly focused" so the auto-focus effect below doesn't steal
	// focus from the destination group of a tab move.
	const skipNextAutoFocusRef = useRef(false);
	useEffect(() => {
		const current = new Map<string, string | undefined>();
		const collectActiveTabIds = (nodes: GroupNode[]): void => {
			for (const n of nodes) {
				if (isTabGroupNode(n)) {
					current.set(n.id, n.activeTabId);
				} else if (isContainerNode(n)) {
					collectActiveTabIds(n.groups);
				}
			}
		};
		collectActiveTabIds(tree.groups);

		if (skipNextAutoFocusRef.current) {
			skipNextAutoFocusRef.current = false;
			prevActiveTabIdsRef.current = current;
			return;
		}

		// Find the group whose activeTabId changed
		for (const [groupId, activeTabId] of current) {
			const prev = prevActiveTabIdsRef.current.get(groupId);
			if (prev !== undefined && prev !== activeTabId && activeTabId) {
				// A group's active tab changed — give it visual focus
				setFocus(groupId);
				break;
			}
		}
		prevActiveTabIdsRef.current = current;
	}, [tree, setFocus]);

	const change = useCallback((next: WorkbenchTree) => {
		if (onChange) onChange(normalizeTree(next));
	}, [onChange]);

	const handleSplitTab = useCallback((tabId: string, fromGroupId: string, targetGroupId: string, direction: 'left' | 'right' | 'top' | 'bottom' | 'full') => {
		// center/full: if same group -> no-op
		if (direction === 'full' && fromGroupId === targetGroupId) {
			return;
		}
		const removed = removeTab(tree, fromGroupId, tabId);
		const tab = removed.tab;
		if (!tab) return;
		const next = direction === 'full'
			? insertTabAt(removed.tree, targetGroupId, 'full', tab)
			: insertTabAt(removed.tree, targetGroupId, direction, tab);
		change(next);
	}, [tree, change]);

	const handleMoveWithinGroup = useCallback((from: { groupId: string; tabId: string }, to: { groupId: string; index: number }) => {
		// Same-group reordering
		if (from.groupId === to.groupId) {
			const next: WorkbenchTree = cloneTree(tree);
			const stack: GroupNode[] = next.groups;
			const visit = (nodes: GroupNode[]): boolean => {
				for (const n of nodes) {
					if (isTabGroupNode(n) && n.id === from.groupId) {
						const moving = n.tabs.find(t => t.id === from.tabId);
						if (!moving) return true;
						const rest = n.tabs.filter(t => t.id !== from.tabId);
						const idx = Math.max(0, Math.min(to.index, rest.length));
						n.tabs = [...rest.slice(0, idx), moving, ...rest.slice(idx)];
						return true;
					}
					if (isContainerNode(n)) {
						if (visit(n.groups)) return true;
					}
				}
				return false;
			};
			visit(stack);
			change(next);
			return;
		}

		// Inter-group move: remove from source then insert into target group at specific index
		const removed = removeTab(tree, from.groupId, from.tabId);
		const movingTab = removed.tab;
		if (!movingTab) return;
		const next: WorkbenchTree = cloneTree(removed.tree);

		const insertIntoTarget = (nodes: GroupNode[]): boolean => {
			for (const n of nodes) {
				if (isTabGroupNode(n) && n.id === to.groupId) {
					const idx = Math.max(0, Math.min(to.index, n.tabs.length));
					n.tabs = [...n.tabs.slice(0, idx), movingTab, ...n.tabs.slice(idx)];
					n.activeTabId = movingTab.id;
					return true;
				}
				if (isContainerNode(n)) {
					if (insertIntoTarget(n.groups)) return true;
				}
			}
			return false;
		};
		insertIntoTarget(next.groups);
		change(normalizeTree(next));
	}, [tree, change]);

	const handleActivate = useCallback(
		(tabId: string, groupId: string) => {
		const next: WorkbenchTree = cloneTree(tree);
		const rec = (nodes: GroupNode[]): void => {
			for (const n of nodes) {
				if (isTabGroupNode(n) && n.id === groupId) {
					n.activeTabId = tabId;
				} else if (isContainerNode(n)) {
					rec(n.groups);
				}
			}
		};
		rec(next.groups);
		change(next);
		setFocus(groupId);
			if (externalOnActivateTab) {
				externalOnActivateTab(tabId, groupId);
			}
		},
		[tree, change, setFocus, externalOnActivateTab]
	);

	// Handler for focus requests from groups
	const handleFocusRequested = useCallback(
		(groupId: string) => {
			setFocus(groupId);
		},
		[setFocus]
	);

	// Ctrl+Alt+Left / Ctrl+Alt+Right — move the currently active tab of the
	// focused group into the adjacent tab group on that side, creating the
	// group on demand. No-op when the source has a single tab and no
	// destination already exists (moving would leave the layout unchanged).
	const handleMoveActiveTabRef = useRef<(direction: 'left' | 'right') => void>((): void => {
		/* replaced by the effect below once the workbench renders */
	});
	useEffect(() => {
		handleMoveActiveTabRef.current = (direction: 'left' | 'right'): void => {
			const groupId = effectiveFocusedGroupId;
			logger.debug('[Workbench] move-tab', { direction, focusedGroupId: groupId });
			if (!groupId) return;
			const loc = (() => {
				const rec = (nodes: GroupNode[]): GroupNode | null => {
					for (const n of nodes) {
						if (isTabGroupNode(n) && n.id === groupId) return n;
						if (isContainerNode(n)) {
							const found = rec(n.groups);
							if (found) return found;
						}
					}
					return null;
				};
				return rec(tree.groups);
			})();
			if (!loc || !isTabGroupNode(loc) || !loc.activeTabId) {
				logger.debug('[Workbench] move-tab abort', { reason: !loc ? 'no-loc' : !isTabGroupNode(loc) ? 'not-tab-group' : 'no-activeTabId' });
				return;
			}
			const { tree: next, destGroupId } = moveTabToAdjacentGroup(tree, groupId, loc.activeTabId, direction);
			if (next === tree) {
				logger.debug('[Workbench] move-tab noop', { groupId, activeTabId: loc.activeTabId, tabCount: loc.tabs.length });
				return;
			}
			logger.debug('[Workbench] move-tab applied', { from: groupId, dest: destGroupId, tabId: loc.activeTabId });
			skipNextAutoFocusRef.current = true;
			change(next);
			if (destGroupId) setFocus(destGroupId);
		};
	}, [tree, effectiveFocusedGroupId, change, setFocus]);

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent): void => {
			if (!e.ctrlKey || !e.altKey) return;
			if (e.key === 'ArrowRight') {
				e.preventDefault();
				handleMoveActiveTabRef.current('right');
			} else if (e.key === 'ArrowLeft') {
				e.preventDefault();
				handleMoveActiveTabRef.current('left');
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return (): void => { window.removeEventListener('keydown', onKeyDown); };
	}, []);

	const handleClose = useCallback((tabId: string, groupId: string) => {
		const { tree: t } = removeTab(tree, groupId, tabId);
		change(t);
	}, [tree, change]);

	const handleCloseOthersInGroup = useCallback((tabId: string, groupId: string) => {
		const next: WorkbenchTree = cloneTree(tree);

		const rec = (nodes: GroupNode[]): void => {
			for (const n of nodes) {
				if (isTabGroupNode(n) && n.id === groupId) {
					n.tabs = n.tabs.filter(t => t.id === tabId);
					n.activeTabId = tabId;
				} else if (isContainerNode(n)) {
					rec(n.groups);
				}
			}
		};

		rec(next.groups);
		change(next);
	}, [tree, change]);

	// Helper function to find group and drop target at cursor position
	const findGroupAndDropTargetAtPosition = useCallback(async (screenX: number, screenY: number): Promise<{ groupId: string; type: 'tabs-container'; tabIndex: number } | { groupId: string; type: 'content-placeholder'; direction: SplitDirection | 'full' } | null> => {
		try {
			// Get current window bounds
			const currentWindow = await getCurrentWindowBounds();
			
			// Convert screen coordinates to viewport coordinates
			const viewportX = screenX - currentWindow.x;
			const viewportY = screenY - currentWindow.y;
			
			// Use elementFromPoint to find element at cursor position
			const element = document.elementFromPoint(viewportX, viewportY);
			
			if (!element) {
				logger.warn('No element found at cursor position', { viewportX, viewportY });
				return null;
			}
			
			// Walk up the DOM tree to find what we're dropping on
			// Priority 1: Check if we're dropping on the tabs container
			// Priority 2: Check if we're dropping on the content placeholder
			let groupId: string | null = null;
			let tabsContainer: HTMLElement | null = null;
			let contentElement: Element | null = null;
			let current: Element | null = element;
			
			// First pass: check if we're directly on tabs-container or its children
			let temp: Element | null = element;
			while (temp) {
				if (temp.classList.contains('tabs-container')) {
					tabsContainer = temp as HTMLElement;
					// Find the group ID by walking up from tabs-container
					let parent: Element | null = temp.parentElement;
					while (parent) {
						const parentGroupId = parent.getAttribute('data-group-id');
						if (parentGroupId) {
							groupId = parentGroupId;
							break;
						}
						parent = parent.parentElement;
					}
					break;
				}
				temp = temp.parentElement;
			}
			
			// Second pass: if not on tabs-container, check for content placeholder or group container
			if (!tabsContainer) {
				current = element;
				while (current) {
					const currentGroupId = current.getAttribute('data-group-id');
						if (currentGroupId) {
							groupId ??= currentGroupId;
							
							// Check if we're dropping on the content placeholder
							if (current.classList.contains('editor-group-content-placeholder')) {
								contentElement = current;
								break;
							}
						}
					current = current.parentElement;
				}
			}
			
			if (!groupId) {
				logger.warn('No group ID found at cursor position', { viewportX, viewportY });
				return null;
			}
			
			// Priority 1: If dropping on tabs container, calculate index and add to group
			if (tabsContainer) {
				const tabIndex = computeDropIndex(tabsContainer, viewportX);
				return { groupId, type: 'tabs-container', tabIndex };
			}
			
			// Priority 2: If dropping on content placeholder, calculate direction for split
			if (!contentElement) {
				// Try to find content placeholder by group ID
				const allContentPlaceholders = document.querySelectorAll('.editor-group-content-placeholder[data-group-id="' + groupId + '"]');
				if (allContentPlaceholders.length > 0 && allContentPlaceholders[0]) {
					contentElement = allContentPlaceholders[0];
				}
			}
			
			if (contentElement) {
				// Calculate direction based on cursor position relative to content placeholder bounds
				const rect = contentElement.getBoundingClientRect();
				const relX = (viewportX - rect.left) / rect.width;
				const relY = (viewportY - rect.top) / rect.height;
				const margin = 0.10; // 10% border zones (same as EditorGroupView)
				
				let direction: SplitDirection | 'full';
				// Prioritize horizontal splits (left, right) over vertical splits (top, bottom)
				if (relX < margin) {
					direction = 'left';
				} else if (relX > 1 - margin) {
					direction = 'right';
				} else if (relY < margin) {
					direction = 'top';
				} else if (relY > 1 - margin) {
					direction = 'bottom';
				} else {
					direction = 'full'; // center: add to same group
				}
				
				return { groupId, type: 'content-placeholder', direction };
			}
			
			// Fallback: if we found a group but no specific drop target, use 'full' direction
			logger.warn('Found group but no specific drop target, using full direction', { groupId, viewportX, viewportY });
			return { groupId, type: 'content-placeholder', direction: 'full' };
		} catch (error) {
			logger.error('Error finding group and drop target at position', { error: String(error), screenX, screenY });
			return null;
		}
	}, []);

	// Handle tab dropped from another window
	const handleTabDropped = useCallback(async (tabData: { tabId: string; title: string; groupId: string; content?: string; cursorX?: number; cursorY?: number }): Promise<boolean> => {
		// Call parent callback if provided (to store content, etc.)
		if (extCallbacks.onWorkbenchTabDropped) {
			const result = await extCallbacks.onWorkbenchTabDropped(tabData);
			if (!result) {
				logger.warn('Parent onWorkbenchTabDropped callback returned false', { tabId: tabData.tabId });
				return false;
			}
		}
		
		// Determine target group and drop target: use cursor position if available
		let dropTarget: { groupId: string; type: 'tabs-container'; tabIndex: number } | { groupId: string; type: 'content-placeholder'; direction: SplitDirection | 'full' } | null = null;
		
		if (tabData.cursorX !== undefined && tabData.cursorY !== undefined) {
			// Small delay to ensure DOM is ready
			await new Promise(resolve => setTimeout(resolve, 50));
			dropTarget = await findGroupAndDropTargetAtPosition(tabData.cursorX, tabData.cursorY);
		}
		
		// Create new tab with titleString for serialization
		const newTab: EditorTab = {
			id: tabData.tabId,
			title: tabData.title,
			titleString: tabData.title
		};
		
		// Find target group or first group as fallback
		let finalTargetGroupId: string | null = null;
		let finalDropTarget: { type: 'tabs-container'; tabIndex: number } | { type: 'content-placeholder'; direction: SplitDirection | 'full' } | null = null;
		
		if (dropTarget) {
			// Verify target group exists in tree
			const findGroupNodeById = (nodes: GroupNode[], targetId: string): GroupNode | null => {
				for (const n of nodes) {
					if (isTabGroupNode(n) && n.id === targetId) {
						return n;
					}
					if (isContainerNode(n)) {
						const found = findGroupNodeById(n.groups, targetId);
						if (found) return found;
					}
				}
				return null;
			};
			
			const targetGroup = findGroupNodeById(tree.groups, dropTarget.groupId);
			if (targetGroup) {
				finalTargetGroupId = dropTarget.groupId;
				if (dropTarget.type === 'tabs-container') {
					finalDropTarget = { type: 'tabs-container', tabIndex: dropTarget.tabIndex };
				} else {
					finalDropTarget = { type: 'content-placeholder', direction: dropTarget.direction };
				}
			} else {
				logger.warn('Target group not found in tree, using first group', { targetGroupId: dropTarget.groupId });
			}
		}
		
		// Fallback to first group if target not found
		if (!finalTargetGroupId) {
			const findFirstTabGroup = (node: GroupNode): GroupNode | null => {
				if (isTabGroupNode(node)) {
					return node;
				}
				if (isContainerNode(node)) {
					for (const group of node.groups) {
						const found = findFirstTabGroup(group);
						if (found) return found;
					}
				}
				return null;
			};
			
			const firstNode = tree.groups[0];
			if (firstNode) {
				const firstGroup = findFirstTabGroup(firstNode);
				if (firstGroup && isTabGroupNode(firstGroup)) {
					finalTargetGroupId = firstGroup.id;
					finalDropTarget = { type: 'tabs-container', tabIndex: firstGroup.tabs.length }; // Add at end
					logger.info('Using first group as fallback', { groupId: finalTargetGroupId, dropTarget: finalDropTarget });
				}
			}
		}
		
		if (!finalTargetGroupId || !finalDropTarget) {
			logger.warn('No target group or drop target found, cannot add tab', { tabId: tabData.tabId });
			return false;
		}
		
		// Use appropriate method based on drop target type
		if (finalDropTarget.type === 'tabs-container') {
			// Add tab to group at specific index (same logic as handleMoveWithinGroup)
			const next: WorkbenchTree = cloneTree(tree);
			const insertIntoTarget = (nodes: GroupNode[]): boolean => {
				for (const n of nodes) {
					if (isTabGroupNode(n) && n.id === finalTargetGroupId) {
						const idx = Math.max(0, Math.min(finalDropTarget.tabIndex, n.tabs.length));
						n.tabs = [...n.tabs.slice(0, idx), newTab, ...n.tabs.slice(idx)];
						n.activeTabId = newTab.id;
						return true;
					}
					if (isContainerNode(n)) {
						if (insertIntoTarget(n.groups)) return true;
					}
				}
				return false;
			};
			insertIntoTarget(next.groups);
			change(normalizeTree(next));
			logger.info('Tab added to group at index', { tabId: tabData.tabId, targetGroupId: finalTargetGroupId, tabIndex: finalDropTarget.tabIndex });
		} else {
			// Use insertTabAt to add tab with proper split handling
			const next = insertTabAt(tree, finalTargetGroupId, finalDropTarget.direction, newTab);
			change(normalizeTree(next));
			logger.info('Tab added using insertTabAt', { tabId: tabData.tabId, targetGroupId: finalTargetGroupId, direction: finalDropTarget.direction });
		}
		
		return true;
	}, [tree, change, findGroupAndDropTargetAtPosition, extCallbacks]);

	// Listen for tabs dropped from other windows
	useEffect(() => {
		const cleanup = onWorkbenchTabDropped((tabData: { tabId: string; title: string; groupId: string; content?: string; cursorX?: number; cursorY?: number }) => {
			void handleTabDropped(tabData);
		});
		return cleanup;
	}, [handleTabDropped]);

	const leafRenderer = useCallback((leaf: EditorGroup) => {
		const extras: Record<string, unknown> = {};
		if (extCallbacks.onDetachToNewWindow) {
			extras['onDetachToNewWindow'] = extCallbacks.onDetachToNewWindow;
		}
		// NOTE: `renderTabContent` is intentionally NOT forwarded to
		// `EditorGroupView` — tab content is rendered once at this level
		// (see `tabContents` + `TabContentHost`), the group only renders
		// empty slots.
		if (extCallbacks.renderTabTitle) {
			extras['renderTabTitle'] = extCallbacks.renderTabTitle;
		}
		if (extCallbacks.onGetTabContent) {
			extras['onGetTabContent'] = extCallbacks.onGetTabContent;
		}
		if (extCallbacks.getTabContextMenuItems) {
			extras['getTabContextMenuItems'] = extCallbacks.getTabContextMenuItems;
		}
		if (extCallbacks.disableTabDetach) {
			extras['disableTabDetach'] = extCallbacks.disableTabDetach;
		}
		// Determine if this group has focus
		const hasFocus = effectiveFocusedGroupId === leaf.id;
		return (
			<EditorGroupView
				group={leaf}
				onMoveTab={handleMoveWithinGroup}
				onSplitTab={handleSplitTab}
				onCloseTab={handleClose}
				onActivateTab={handleActivate}
				onCloseOthersInGroup={handleCloseOthersInGroup}
				hasFocus={hasFocus}
				onFocusRequested={handleFocusRequested}
				onChangeFullscreenTabId={setFullscreenTabId}
				maximizedTabId={modalOwnerTabId}
				modalBody={modalBody}
				getTabHost={getTabHost}
				{...(testId && { 'data-testid': testId })}
				{...extras}
			/>
		);
	}, [
		handleMoveWithinGroup,
		handleSplitTab,
		handleClose,
		handleCloseOthersInGroup,
		handleActivate,
		handleFocusRequested,
		extCallbacks.onDetachToNewWindow,
		extCallbacks.renderTabTitle,
		extCallbacks.onGetTabContent,
		extCallbacks.getTabContextMenuItems,
		extCallbacks.disableTabDetach,
		effectiveFocusedGroupId,
		modalOwnerTabId,
		modalBody,
		getTabHost,
		testId
	]);

	return (
		<div
			className={`part editor ${className ?? ''}`}
			{...(testId && {
				'data-testid': testId,
				'data-root-orientation': tree.orientation,
				'data-root-group-count': String(tree.groups.length),
				'data-focused-group-id': effectiveFocusedGroupId ?? ''
			})}
			style={{ display: 'flex', flex: 1, minWidth: 0, minHeight: 0, ...style }}
		>
			<div className="content" style={{ display: 'flex', flex: 1, minWidth: 0, minHeight: 0 }}>
				{tree.groups.length === 0 ? (
					emptyFallback ?? null
				) : (
					<GroupContainer
						node={{ id: 'root', orientation: tree.orientation, groups: tree.groups, sizes: tree.sizes }}
						callbacks={extCallbacks}
						renderLeaf={leafRenderer}
						onNodeSizesChange={onSizesChange}
						dataTestIdBase={testId}
					/>
				)}
			</div>
			{/*
			 * Tab content portals — rendered AFTER `GroupContainer` on
			 * purpose: a `TabSlot`'s ref attaches before these commit, so
			 * a tab's host node is already inside its slot (and the
			 * document) when the portal content mounts — embedded editors
			 * (Monaco, …) measure their size correctly first time.
			 *
			 * Rendered in `orderedTabs` (id-sorted), NOT `allTabs` (tree
			 * order) — see the `orderedTabs` comment: a stable sibling
			 * order is what keeps a tab reorder from moving a portal
			 * fiber and tearing down its embedded editors.
			 *
			 * Filtered by `mountedTabIds` (lazy-once): a tab is only
			 * portalled once it has appeared as a group's active tab.
			 * Once mounted it stays so for the lifetime of this
			 * workbench — switching away just toggles the slot's
			 * display, never tears down the subtree.
			 */}
			{orderedTabs.map((tab) => mountedTabIds.has(tab.id) ? (
				<TabContentHost
					key={tab.id}
					host={getTabHost(tab.id)}
					content={tabContents.get(tab.id)}
				/>
			) : null)}
			<Modal
				isOpen={fullscreenTab !== null}
				onClose={() => { setFullscreenTabId(null); }}
				onClosed={handleModalClosed}
				title={fullscreenTab?.fullscreenModalTitle ?? (fullscreenTab ? getTabTitleString(fullscreenTab, '') : '')}
			>
				{/*
				 * Empty mount point. The maximized tab's `TabContentHost`
				 * relocates its host node into this div via `appendChild`
				 * — the modal shows the SAME instance as the normal view,
				 * never a freshly-mounted copy.
				 */}
				<div
					ref={setModalBody}
					style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, width: '100%', height: '100%' }}
				/>
			</Modal>
		</div>
	);
});

EditorWorkbench.displayName = 'EditorWorkbench';

export default EditorWorkbench;
