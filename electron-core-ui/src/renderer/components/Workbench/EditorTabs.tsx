import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import './styles/tabs.css';
import Tab from './Tab';
import type { EditorGroup, EditorTab, EditorWorkbenchCallbacks } from './types';
import { clearEditorDragData, computeDropIndex, getEditorDragData, setEditorDragData } from './dnd';
import { createAuxWindow, getCurrentWindowBounds, getCursorScreenPoint, getWindowUnderCursor, sendWorkbenchTabToWindow } from './ipc';
import { logger } from '../../services/logger';
import { getTabTitleString } from './utils';
import { ScrollableElement } from '../ScrollableElement';
import { ContextMenu } from '../ContextMenu/ContextMenu';
import type { ContextMenuItem } from '../ContextMenu/ContextMenu';

export interface EditorTabsProps extends EditorWorkbenchCallbacks {
	group: EditorGroup;
	/**
	 * When true, the tab labels are visually dimmed (reduced opacity).
	 * Used to indicate that the group's content does not have focus.
	 */
	dimmed?: boolean;
	/**
	 * Called when a tab is double-clicked. Used for fullscreen modal feature.
	 */
	onTabDoubleClick?: (tabId: string) => void;
}

export const EditorTabs: React.FC<EditorTabsProps> = ({
	group,
	onCloseTab,
	onCloseOthersInGroup,
	onMoveTab,
	onActivateTab,
	onGetTabContent,
	onDetachToNewWindow,
	renderTabTitle,
	getTabContextMenuItems,
	dimmed,
	onTabDoubleClick
}) => {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [_dragOverIndex, setDragOverIndex] = useState<number | null>(null);
	const [hoveredTabIndex, setHoveredTabIndex] = useState<number | null>(null);
	const [hoveredSide, setHoveredSide] = useState<'left' | 'right' | null>(null);

	const [draggingTabId, setDraggingTabId] = useState<string | undefined>(undefined);

	const [contextMenuState, setContextMenuState] = useState<{
		visible: boolean;
		x: number;
		y: number;
		items: ContextMenuItem[];
	}>({
		visible: false,
		x: 0,
		y: 0,
		items: []
	});

	// FLIP animation: store previous rects per tab id and refs to elements
	const tabElementByIdRef = useRef<Map<string, HTMLElement>>(new Map());
	const prevRectsRef = useRef<Map<string, DOMRect>>(new Map());

	// Measure and animate when the order of tabs changes
	const tabsOrderKey = useMemo(() => group.tabs.map(t => t.id).join(','), [group.tabs]);

	useLayoutEffect(() => {
		// Current rects
		const currentRects = new Map<string, DOMRect>();
		tabElementByIdRef.current.forEach((el, id) => {
			const rect = el.getBoundingClientRect();
			currentRects.set(id, rect);
		});

		// Animate elements that existed before and after
		currentRects.forEach((rect, id) => {
			const prev = prevRectsRef.current.get(id);
			if (!prev) return;
			const dx = prev.left - rect.left;
			// Only animate if there is a noticeable horizontal delta
			if (Math.abs(dx) > 0.5) {
				const el = tabElementByIdRef.current.get(id);
				if (!el) return;
				// Set initial transform without transition
				el.style.transition = 'none';
				el.style.transform = `translateX(${dx}px)`;
				// In next frame, animate back to identity
				requestAnimationFrame(() => {
					el.style.transition = 'transform 150ms ease';
					el.style.transform = '';
				});
			}
		});

		// Save current rects for next pass
		prevRectsRef.current = currentRects;
	}, [tabsOrderKey]);

	const onDragStartTab = useCallback(
		(e: React.DragEvent, tabId: string) => {
			setEditorDragData(e, { editorId: tabId, sourceGroupId: group.id });
			setDraggingTabId(tabId);
		},
		[group.id]
	);

	const onDragEndTab = useCallback(async () => {
		if (!draggingTabId) {
			return
		}
		
		const tabId = draggingTabId
		
		try {
			// Small delay to ensure cursor position is accurate after drag ends
			await new Promise(resolve => setTimeout(resolve, 50))
			
			const [cursor, currentWindow, windowUnderCursor] = await Promise.all([
				getCursorScreenPoint(),
				getCurrentWindowBounds(),
				getWindowUnderCursor()
			])

			// Check if cursor is inside current window bounds (with small margin for edge cases)
			const margin = 5
			const insideCurrentWindow =
				cursor.x >= currentWindow.x - margin &&
				cursor.x <= currentWindow.x + currentWindow.width + margin &&
				cursor.y >= currentWindow.y - margin &&
				cursor.y <= currentWindow.y + currentWindow.height + margin

			// Check if window under cursor is different from current window
			const isDifferentWindow = windowUnderCursor && windowUnderCursor.windowId !== currentWindow.windowId

			// If cursor is outside current window and over another window, send tab to that window
			if (!insideCurrentWindow && isDifferentWindow) {
				const tab = group.tabs.find((t) => t.id === tabId)
				if (!tab) {
					logger.warn('EditorTabs: Tab not found', { draggingTabId: tabId, groupId: group.id })
					return
				}
				
				const tabTitleString = getTabTitleString(tab, tabId)
				// Send tab to target window
				const tabContent = onGetTabContent?.(tabId)
				const tabData: { tabId: string; title: string; groupId: string; content?: string } = {
					tabId: tabId,
					title: tabTitleString,
					groupId: group.id
				}
				if (tabContent !== undefined) {
					tabData.content = tabContent
				} else {
					logger.warn('EditorTabs: No tab content available', { tabId: tabId })
				}
				
				// Include cursor position to determine target group in destination window
				const success = await sendWorkbenchTabToWindow(windowUnderCursor.windowId, {
					...tabData,
					cursorX: cursor.x,
					cursorY: cursor.y
				})

				if (success) {
					// Remove tab from current window
					onCloseTab?.(tabId, group.id)
				} else {
					logger.warn('EditorTabs: Failed to send tab to target window', { tabId: tabId, targetWindowId: windowUnderCursor.windowId })
				}
			} else if (!insideCurrentWindow && !isDifferentWindow) {
				// Cursor is outside current window but not over another window, create new window
				const tab = group.tabs.find((t) => t.id === tabId)
				if (!tab) {
					logger.warn('EditorTabs: Tab not found for new window creation', { draggingTabId: tabId })
					return
				}
				
				// Use onDetachToNewWindow callback if available (preferred method)
				if (onDetachToNewWindow) {
					try {
						onDetachToNewWindow(tabId, group.id, cursor.x, cursor.y)
						// Note: The callback should handle opening the window and closing/moving the tab
						// But we still need to close the tab from the current window
						onCloseTab?.(tabId, group.id)
					} catch (error) {
						logger.error('EditorTabs: Error in onDetachToNewWindow callback', { error: String(error), tabId, groupId: group.id })
						// Fallback to createAuxWindow on error
					const tabTitleString = getTabTitleString(tab, tabId)
					await createAuxWindow(
						{ editorId: tabId, title: tabTitleString },
						{ x: cursor.x - 400, y: cursor.y - 60, width: 900, height: 600 }
					)
						onMoveTab?.({ groupId: group.id, tabId: tabId }, { groupId: group.id, index: group.tabs.findIndex(t => t.id === tabId) })
						onCloseTab?.(tabId, group.id)
					}
				} else {
					// Fallback to createAuxWindow if callback is not available (for compatibility)
					const tabTitleString = getTabTitleString(tab, tabId)
					await createAuxWindow(
						{ editorId: tabId, title: tabTitleString },
						{ x: cursor.x - 400, y: cursor.y - 60, width: 900, height: 600 }
					)
					onMoveTab?.({ groupId: group.id, tabId: tabId }, { groupId: group.id, index: group.tabs.findIndex(t => t.id === tabId) })
					onCloseTab?.(tabId, group.id)
				}
			}
		} catch (error) {
			logger.error('EditorTabs: Error in onDragEndTab', { error: String(error), draggingTabId: tabId })
		} finally {
			setDraggingTabId(undefined)
			clearEditorDragData()
		}
	}, [draggingTabId, group.id, group.tabs, onCloseTab, onMoveTab, onGetTabContent, onDetachToNewWindow])

	const updateDragOver = useCallback((e: React.DragEvent) => {
		if (!containerRef.current) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
		const container = containerRef.current;
		const idx = computeDropIndex(container, e.clientX);
		setDragOverIndex(idx);

		const children = Array.from(container.children).filter(
			(el): el is HTMLElement => el instanceof HTMLElement && el.classList.contains('tab')
		);
		let matchedIndex: number | null = null;
		let side: 'left' | 'right' | null = null;
		for (let i = 0; i < children.length; i++) {
			const child = children[i];
			if (!child) continue;
			const rect = child.getBoundingClientRect();
			if (e.clientX >= rect.left && e.clientX <= rect.right) {
				matchedIndex = i;
				const mid = rect.left + rect.width / 2;
				side = e.clientX < mid ? 'left' : 'right';
				break;
			}
		}
		if (matchedIndex === null && children.length > 0) {
			const firstChild = children[0];
			const lastChild = children[children.length - 1];
			if (!firstChild || !lastChild) {
				setHoveredTabIndex(null);
				setHoveredSide(null);
				return;
			}
			const firstRect = firstChild.getBoundingClientRect();
			const lastRect = lastChild.getBoundingClientRect();
			if (e.clientX < firstRect.left) {
				matchedIndex = 0;
				side = 'left';
			} else if (e.clientX > lastRect.right) {
				matchedIndex = children.length - 1;
				side = 'right';
			}
		}
		setHoveredTabIndex(matchedIndex);
		setHoveredSide(side);
	}, []);

	const onDragLeaveTabs = useCallback(() => {
		setDragOverIndex(null);
		setHoveredTabIndex(null);
		setHoveredSide(null);
	}, []);

	const onDropTabs = useCallback(
		(e: React.DragEvent) => {
			if (!containerRef.current) return;
			const data = getEditorDragData(e);
			if (!data) return;
			e.preventDefault();
			let idx = computeDropIndex(containerRef.current, e.clientX);
			// Adjust index for same-group reordering: after removing the dragged tab,
			// the target index must be decremented if it was originally to the right.
			if (data.sourceGroupId === group.id) {
				const fromIndex = group.tabs.findIndex(t => t.id === data.editorId);
				if (fromIndex >= 0 && idx > fromIndex) {
					idx = idx - 1;
				}
			}
			setDragOverIndex(null);
			setHoveredTabIndex(null);
			setHoveredSide(null);
			onMoveTab?.({ groupId: data.sourceGroupId, tabId: data.editorId }, { groupId: group.id, index: idx });
			clearEditorDragData();
		},
		[group.id, group.tabs, onMoveTab]
	);

	const handleTabContextMenu = useCallback(
		(event: React.MouseEvent, tab: EditorTab) => {
			if (!getTabContextMenuItems) {
				return;
			}
			event.preventDefault();

			const close = () => {
				onCloseTab?.(tab.id, group.id);
			};

			const closeOthersInGroup = () => {
				onCloseOthersInGroup?.(tab.id, group.id);
			};

			const items = getTabContextMenuItems(tab, group.id, { close, closeOthersInGroup }) ?? [];
			if (!items.length) {
				return;
			}

			setContextMenuState({
				visible: true,
				x: event.clientX,
				y: event.clientY,
				items
			});
		},
		[getTabContextMenuItems, group.id, onCloseTab, onCloseOthersInGroup]
	);

	// Ensure the active tab is scrolled into view when it changes
	useLayoutEffect(() => {
		if (!containerRef.current || !group.activeTabId) {
			return;
		}
		const container = containerRef.current;
		const activeEl = tabElementByIdRef.current.get(group.activeTabId);
		if (!activeEl) {
			return;
		}

		// Find the scrollable container created by ScrollableElement (scrollable-content)
		let scrollable: HTMLElement | null = container.parentElement;
		while (scrollable && !scrollable.classList.contains('scrollable-content')) {
			scrollable = scrollable.parentElement;
		}
		if (!scrollable) {
			return;
		}

		const viewportRect = scrollable.getBoundingClientRect();
		const activeRect = activeEl.getBoundingClientRect();
		const padding = 24;

		const leftVisible = viewportRect.left + padding;
		const rightVisible = viewportRect.right - padding;

		if (activeRect.left < leftVisible) {
			scrollable.scrollLeft -= leftVisible - activeRect.left;
		} else if (activeRect.right > rightVisible) {
			scrollable.scrollLeft += activeRect.right - rightVisible;
		}
	}, [group.activeTabId]);

	return (
		<div className="tabs-and-actions-container">
			<ScrollableElement
				options={{
					horizontal: 'auto',
					vertical: 'hidden',
					useShadows: false,
					handleMouseWheel: true,
					mouseWheelSmoothScroll: false,
					mouseWheelHorizontal: true,
					horizontalScrollbarSize: 3
				}}
				className={`tabs-container-wrapper${dimmed ? ' dimmed' : ''}`}
				style={{
					flex: 1,
					height: 'var(--editor-group-tab-height, 35px)',
					minWidth: 0
				}}
			>
				<div
					ref={containerRef}
					className={`tabs-container${dimmed ? ' dimmed' : ''}`}
					role="tablist"
					aria-label="Editor tabs"
					onDragEnter={updateDragOver}
					onDragOver={updateDragOver}
					onDragLeave={onDragLeaveTabs}
					onDrop={onDropTabs}
					style={{
						display: 'flex',
						height: '100%'
					}}
				>
					{group.tabs.map((tab) => (
						<Tab
							key={tab.id}
							tab={tab}
							isActive={tab.id === group.activeTabId}
							draggable
							{...(renderTabTitle && { renderTabTitle })}
							// Track DOM element for FLIP animations
							refCallback={(el) => {
								if (el) {
									tabElementByIdRef.current.set(tab.id, el);
								} else {
									tabElementByIdRef.current.delete(tab.id);
								}
							}}
							onDragStart={(e) => { onDragStartTab(e, tab.id); }}
							onDragEnd={() => { void onDragEndTab(); }}
							showDropMarker={((): 'left' | 'right' | undefined => {
								const tabIndex = group.tabs.indexOf(tab);
								if (hoveredTabIndex === tabIndex && hoveredSide) {
									return hoveredSide;
								}
								// End case: outside to the right -> show right edge of last tab
								if (hoveredTabIndex === null && hoveredSide === 'right' && tabIndex === group.tabs.length - 1) {
									return 'right';
								}
								// Start case: outside to the left -> show left edge of first tab
								if (hoveredTabIndex === null && hoveredSide === 'left' && tabIndex === 0) {
									return 'left';
								}
								return undefined;
							})()}
							onActivate={() => { onActivateTab?.(tab.id, group.id); }}
							onClose={(tabId) => onCloseTab?.(tabId, group.id)}
							onContextMenu={(e) => { handleTabContextMenu(e, tab); }}
							onDoubleClick={(tabId) => onTabDoubleClick?.(tabId)}
						/>
					))}
				</div>
			</ScrollableElement>
			<ContextMenu
				visible={contextMenuState.visible}
				x={contextMenuState.x}
				y={contextMenuState.y}
				items={contextMenuState.items}
				onRequestClose={() => {
					setContextMenuState((prev) => ({ ...prev, visible: false }));
				}}
			/>
		</div>
	);
};

export default EditorTabs;
