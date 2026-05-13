import React, { useCallback, useMemo, useRef, useState } from 'react';
import { EditorTabs } from './EditorTabs';
import { Modal } from '../Modal';
import { useSetting } from '../../hooks/useSettings';
import type { EditorGroup, EditorWorkbenchCallbacks, SplitDirection } from './types';
import { getEditorDragData, isEditorDragEvent } from './dnd';
import { getTabTitleString } from './utils';
import { useWorkbenchResize, computeTabDisplay } from './WorkbenchResizeContext';

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
	 * Optional test id base for stable E2E selectors.
	 */
	'data-testid'?: string;
}

export const EditorGroupView: React.FC<EditorGroupViewProps> = (props) => {
	const { group, renderTabContent, onSplitTab, onActivateTab, hasFocus = false, onFocusRequested, 'data-testid': dataTestId } = props;
	const [splitTarget, setSplitTarget] = useState<SplitDirection | 'center' | undefined>(undefined);
	const [isEditorDrag, setIsEditorDrag] = useState<boolean>(false);
	const [fullscreenTabId, setFullscreenTabId] = useState<string | null>(null);
	const contentRef = useRef<HTMLDivElement | null>(null);
	const [advancedEffects] = useSetting('appearance:advancedVisualEffects');
	// Hide every tab body — including the active one — while a sash is
	// being dragged. Heavy embeds (Monaco, Electron `<webview>`,
	// ResizeObserver-driven charts) otherwise relayout on every
	// mousemove and visibly lag the drag.
	const { isResizing } = useWorkbenchResize();

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

	// Handle tab double-click for fullscreen modal
	const handleTabDoubleClick = useCallback((tabId: string) => {
		const tab = group.tabs.find((t) => t.id === tabId);
		if (tab?.allowFullscreen) {
			setFullscreenTabId(tabId);
		}
	}, [group.tabs]);

	// Get the fullscreen tab
	const fullscreenTab = useMemo(() => {
		if (!fullscreenTabId) return null;
		return group.tabs.find((t) => t.id === fullscreenTabId) ?? null;
	}, [fullscreenTabId, group.tabs]);

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
				 */}
				{[...group.tabs]
					.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
					.map((tab) => {
						const isActive = tab.id === group.activeTabId;
						const content = tabContents.get(tab.id);
						return (
							<div
								key={tab.id}
								style={{
									display: computeTabDisplay(isActive, isResizing),
									flex: 1,
									minHeight: 0
								}}
							>
								<CachedTabContentSlot content={content} />
							</div>
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
				isOpen={fullscreenTabId !== null}
				onClose={() => {
					setFullscreenTabId(null);
				}}
				title={fullscreenTab?.fullscreenModalTitle ?? (fullscreenTab ? getTabTitleString(fullscreenTab, '') : '')}
			>
				{fullscreenTab ? (
					renderTabContent?.(fullscreenTab) ?? fullscreenTab.content ?? <span>{fullscreenTab.title}</span>
				) : null}
			</Modal>
		</div>
	);
};

export default EditorGroupView;
