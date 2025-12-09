import React, { useCallback, useMemo, useRef, useState } from 'react';
import { EditorTabs } from './EditorTabs';
import { Modal } from '../Modal';
import type { EditorGroup, EditorWorkbenchCallbacks, SplitDirection } from './types';
import { getEditorDragData, isEditorDragEvent } from './dnd';
import { getTabTitleString } from './utils';

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
}

export const EditorGroupView: React.FC<EditorGroupViewProps> = (props) => {
	const { group, renderTabContent, onSplitTab, onActivateTab, hasFocus = false, onFocusRequested } = props;
	const [splitTarget, setSplitTarget] = useState<SplitDirection | 'center' | undefined>(undefined);
	const [isEditorDrag, setIsEditorDrag] = useState<boolean>(false);
	const [fullscreenTabId, setFullscreenTabId] = useState<string | null>(null);
	const contentRef = useRef<HTMLDivElement | null>(null);

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
			// Only start intercepting events when an editor tab is being dragged
			pointerEvents: splitTarget && isEditorDrag ? 'auto' : 'none',
			backgroundColor: 'rgba(0, 0, 0, 0.40)', // 20% black
			//backdropFilter: 'blur(1px)', // slight blur (removed... too laggy)
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
	}, [splitTarget, isEditorDrag]);

	const isBlockedDrop = useCallback((e: React.DragEvent<HTMLDivElement>): boolean => {
		const data = getEditorDragData(e);
		// Only consider drops coming from editor tab drag-and-drop
		if (!data) return false;
		// Block when dragging the only tab of this group over its own content
		return Boolean(
			data.sourceGroupId === group.id &&
			group.tabs.length === 1 &&
			group.tabs[0]?.id === data.editorId
		);
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
		<div className="editor-group-container" data-group-id={group.id} style={{ display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative', height: '100%' }}>
			<div className="title" style={{ display: 'flex' }}>
				<EditorTabs {...props} onActivateTab={handleActivateTab} dimmed={!hasFocus} onTabDoubleClick={handleTabDoubleClick} />
			</div>
			<div
				ref={contentRef}
				className="editor-group-content-placeholder"
				data-group-id={group.id}
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
					{group.tabs.length === 0
						? <span>No tab</span>
						: group.tabs.map((tab) => {
							const isActive = tab.id === group.activeTabId;
							const content =
								(renderTabContent?.(tab) ??
									tab.content ??
									<span>{tab.title}</span>);
							return (
								<div
									key={tab.id}
									style={{
										display: isActive ? 'flex' : 'none',
										flex: 1,
										minHeight: 0
									}}
								>
									{content}
								</div>
							);
						})}
				</div>
				<div
					style={overlayStyle}
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


