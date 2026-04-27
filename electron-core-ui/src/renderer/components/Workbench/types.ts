import type { ContextMenuItem } from '../ContextMenu/ContextMenu'

export type SplitDirection = 'left' | 'right' | 'top' | 'bottom' | 'full';
export type Orientation = 'vertical' | 'horizontal';

export interface EditorTab {
	id: string;
	/**
	 * Title of the tab as a React node. Can be a string, JSX element, or any React node.
	 * For serialization purposes (IPC, logs, etc.), use titleString instead.
	 */
	title: React.ReactNode;
	/**
	 * String representation of the title for serialization purposes (IPC, logs, etc.).
	 * If not provided, will be extracted from title if it's a string or primitive.
	 */
	titleString?: string;
	isDirty?: boolean;
	isPinned?: boolean;
	isSticky?: boolean;
	/**
	 * Optional React content for this tab. When provided, it will be rendered
	 * in the group's content area when the tab is active.
	 */
	content?: React.ReactNode;
	/**
	 * When true, double-clicking on the tab opens a fullscreen modal with the tab content.
	 * Defaults to false.
	 */
	allowFullscreen?: boolean;
	/**
	 * Custom title for the fullscreen modal. If not provided, the tab title will be used.
	 */
	fullscreenModalTitle?: React.ReactNode;
	/**
	 * Increment this counter to force the tab content to re-render.
	 * Useful when tab metadata (breadcrumbs, icons) changes without changing the tab ID.
	 */
	contentVersion?: number;
}

export interface EditorGroup {
	id: string;
	tabs: EditorTab[];
	activeTabId?: string;
}

export interface WorkbenchState {
	groups: EditorGroup[];
	activeGroupId?: string;
}

export interface EditorWorkbenchCallbacks {
	onMoveTab?: (from: { groupId: string; tabId: string }, to: { groupId: string; index: number }) => void;
	onSplitTab?: (tabId: string, fromGroupId: string, targetGroupId: string, direction: SplitDirection) => void;
	onCloseTab?: (tabId: string, groupId: string) => void;
	/**
	 * Close all other tabs in the same group as the given tab.
	 */
	onCloseOthersInGroup?: (tabId: string, groupId: string) => void;
	onDetachToNewWindow?: (tabId: string, groupId: string, cursorX?: number, cursorY?: number) => void;
	onActivateTab?: (tabId: string, groupId: string) => void;
	renderTabContent?: (tab: EditorTab) => React.ReactNode;
	/**
	 * Render the title of a tab. If provided, this will be used instead of the tab's title property.
	 * Should return a React node that will be rendered inside the tab's label span.
	 */
	renderTabTitle?: (tab: EditorTab) => React.ReactNode;
	onGetTabContent?: (tabId: string) => string | undefined;
	/**
	 * Called when a tab is dropped from another window.
	 * Should return true if the tab was successfully handled, false otherwise.
	 */
	onWorkbenchTabDropped?: (tabData: { tabId: string; title: string; groupId: string; content?: string; cursorX?: number; cursorY?: number }) => boolean | Promise<boolean>;
	/**
	 * Optional callback to build a context menu for a tab.
	 * The actions helpers will perform the default close behaviours for this workbench.
	 */
	getTabContextMenuItems?: (
		tab: EditorTab,
		groupId: string,
		actions: { close: () => void; closeOthersInGroup: () => void }
	) => ContextMenuItem[] | undefined;
	/**
	 * When true, dragging a tab outside the current window's bounds is
	 * a no-op: the tab stays in its original group and no new
	 * BrowserWindow is created. Use this to gate the detach-to-new-
	 * window pathway behind a host-app feature flag while leaving
	 * intra-workbench drag/drop and split behaviour unchanged. Default
	 * (omitted / false): the existing detach pathway runs.
	 */
	disableTabDetach?: boolean;
}

/**
 * New hierarchical tree types
 */
export interface TabGroupNode {
	id: string;
	tabs: EditorTab[];
	activeTabId?: string;
}

export interface ContainerGroupNode {
	id: string;
	orientation: Orientation;
	groups: GroupNode[];
	/** Optional sizes as ratios (0-1) for each child group */
	sizes?: number[] | undefined;
}

export type GroupNode = TabGroupNode | ContainerGroupNode;

export interface WorkbenchTree {
	orientation: Orientation;
	groups: GroupNode[];
	/** Optional sizes as ratios (0-1) for each root-level group */
	sizes?: number[] | undefined;
}

export function isContainerNode(node: GroupNode): node is ContainerGroupNode {
	return 'groups' in (node as ContainerGroupNode);
}

export function isTabGroupNode(node: GroupNode): node is TabGroupNode {
	return 'tabs' in (node as TabGroupNode);
}
