import type { ContainerGroupNode, EditorTab, GroupNode, Orientation, TabGroupNode, WorkbenchTree } from './types';
import { isContainerNode, isTabGroupNode } from './types';

let idCounter = 0;
const generateId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

export interface FindResult {
	parent: ContainerGroupNode | null; // null when at root groups
	node: GroupNode | null;
	parentPath: number[]; // indexes from root.groups down to parent
	indexInParent: number; // index of node in parent.groups, -1 if not found
}

/**
 * Structural clone of a workbench group / tree.
 *
 * `JSON.parse(JSON.stringify(...))` looks tempting but it strips every
 * `EditorTab.content` / `EditorTab.title` ReactNode down to a plain
 * object — when the tab is then re-rendered, React sees a "new" content
 * tree and remounts it, which disposes any embedded Monaco editor
 * mid-render and surfaces the cascade of `InstantiationService has been
 * disposed` / `Cannot read properties of undefined (reading 'domNode')`
 * errors observed during a same-group tab reorder.
 *
 * We instead clone *structurally*: every container / tab-group / array
 * gets a fresh allocation, but each `EditorTab` reference passes
 * through unchanged. Mutations to the tree shape (insert / remove /
 * reorder) are still safe because the arrays are new; the tab payload
 * stays referentially stable, so React's reconciler keeps the same
 * subtree mounted.
 */
function cloneGroupNode<T extends GroupNode>(node: T): T {
	if (isTabGroupNode(node)) {
		const clone: TabGroupNode = {
			id: node.id,
			tabs: [...node.tabs]
		};
		if (node.activeTabId !== undefined) clone.activeTabId = node.activeTabId;
		return clone as T;
	}
	const container: ContainerGroupNode = {
		id: node.id,
		orientation: node.orientation,
		groups: node.groups.map(cloneGroupNode)
	};
	if (node.sizes !== undefined) container.sizes = [...node.sizes];
	return container as T;
}

export function cloneNode<T extends GroupNode>(node: T): T {
	return cloneGroupNode(node);
}

export function cloneTree(tree: WorkbenchTree): WorkbenchTree {
	const clone: WorkbenchTree = {
		orientation: tree.orientation,
		groups: tree.groups.map(cloneGroupNode)
	};
	if (tree.sizes !== undefined) clone.sizes = [...tree.sizes];
	return clone;
}

/**
 * Every tab across the whole tree, in depth-first group order.
 *
 * `EditorWorkbench` renders the tab *content* once per entry here
 * (above the split-pane tree), so a tab keeps its single React instance
 * no matter which group currently holds it — moving a tab between
 * groups becomes a pure DOM relocation instead of an unmount/remount.
 */
export function flattenTabs(tree: WorkbenchTree): EditorTab[] {
	const out: EditorTab[] = [];
	const walk = (nodes: GroupNode[]): void => {
		for (const node of nodes) {
			if (isTabGroupNode(node)) {
				out.push(...node.tabs);
			} else {
				walk(node.groups);
			}
		}
	};
	walk(tree.groups);
	return out;
}

/**
 * Every group's `activeTabId` flattened. Drives the workbench's
 * lazy-mount policy: a tab's React subtree is materialised the first
 * time it appears here (= becomes the visible tab of its group) and
 * stays mounted thereafter. Tabs that have never been visible — e.g.
 * extras opened in the background by a tree-replace — pay no React
 * cost until the user activates them.
 */
export function collectActiveTabIds(tree: WorkbenchTree): string[] {
	const out: string[] = [];
	const walk = (nodes: GroupNode[]): void => {
		for (const node of nodes) {
			if (isTabGroupNode(node)) {
				if (node.activeTabId) out.push(node.activeTabId);
			} else {
				walk(node.groups);
			}
		}
	};
	walk(tree.groups);
	return out;
}

export function findGroup(tree: WorkbenchTree, groupId: string): FindResult {
	const rec = (parent: ContainerGroupNode | null, groups: GroupNode[], path: number[]): FindResult => {
		for (let i = 0; i < groups.length; i++) {
			const maybeNode: GroupNode | undefined = groups[i];
			if (!maybeNode) continue;
			const node = maybeNode;
			if ((node as TabGroupNode).id === groupId) {
				return { parent, node, parentPath: path, indexInParent: i };
			}
			if (isContainerNode(node)) {
				const res = rec(node, node.groups, [...path, i]);
				if (res.node) return res;
			}
		}
		return { parent, node: null, parentPath: path, indexInParent: -1 };
	};
	return rec(null, tree.groups, []);
}

export function getContainerAtPath(tree: WorkbenchTree, path: number[]): ContainerGroupNode | null {
	let container: ContainerGroupNode | null = { id: 'root', orientation: tree.orientation, groups: tree.groups } as ContainerGroupNode;
	for (const idx of path) {
		const next: GroupNode | undefined = container.groups[idx];
		if (!next || !isContainerNode(next)) return null;
		container = next;
	}
	return container;
}

/**
 * Pick which remaining tab becomes active after the active tab is
 * closed. Receives EVERY tab left in the workbench (across all groups,
 * the closed one already removed) and returns the id to activate, or
 * `undefined` to defer to the default (first remaining tab in the closed
 * tab's own group). Lets the host drive a most-recently-used choice —
 * including activating a tab in a DIFFERENT group — without coupling this
 * module to the navigation history.
 */
export type PickNextActiveTab = (remainingTabs: EditorTab[]) => string | undefined;

export function removeTab(
	tree: WorkbenchTree,
	fromGroupId: string,
	tabId: string,
	pickNextActive?: PickNextActiveTab
): { tree: WorkbenchTree; tab?: EditorTab; nextActiveGroupId?: string } {
	const draft = cloneTree(tree);
	const loc = findGroup(draft, fromGroupId);
	if (!loc.node || !isTabGroupNode(loc.node)) {
		return { tree: draft };
	}
	const closedGroup = loc.node;
	const tab = closedGroup.tabs.find(t => t.id === tabId);
	const wasActive = closedGroup.activeTabId === tabId;
	closedGroup.tabs = closedGroup.tabs.filter(t => t.id !== tabId);

	let nextActiveGroupId: string | undefined;
	if (wasActive) {
		// First, keep the closed tab's OWN group internally consistent: its
		// `activeTabId` pointed at the now-removed tab, so repair it to the
		// first remaining tab (or drop it when the group is now empty). This
		// holds regardless of where focus ends up — the group must never be
		// left pointing at a tab that no longer exists.
		if (closedGroup.tabs[0]) {
			closedGroup.activeTabId = closedGroup.tabs[0].id;
		} else {
			delete (closedGroup as { activeTabId?: string }).activeTabId;
		}

		// Then pick the most-recently-used remaining tab ACROSS ALL GROUPS
		// (VSCode-style), so close-to-previous stays consistent with the
		// Ctrl+Tab switcher. The host ranks every surviving tab by navigation
		// history; the winner may live in another group, in which case we
		// activate it there and report that group so the caller can move
		// focus to it. With no resolver / a decline / a missing pick, we fall
		// back to the first remaining tab in the closed group (set above).
		const picked = pickNextActive?.(flattenTabs(draft));
		const targetGroupId = picked !== undefined ? findGroupContainingTab(draft, picked) : null;
		const targetGroup = targetGroupId !== null ? findGroup(draft, targetGroupId).node : null;
		if (picked !== undefined && targetGroup && isTabGroupNode(targetGroup)) {
			targetGroup.activeTabId = picked;
			nextActiveGroupId = targetGroup.id;
		} else if (closedGroup.tabs[0]) {
			nextActiveGroupId = closedGroup.id;
		}
	}
	const normalized = normalizeTree(draft);
	const result: { tree: WorkbenchTree; tab?: EditorTab; nextActiveGroupId?: string } = { tree: normalized };
	if (tab) result.tab = tab;
	// Only report the next-active group when it still exists after
	// normalization (an emptied group is pruned).
	if (nextActiveGroupId !== undefined && findGroup(normalized, nextActiveGroupId).node) {
		result.nextActiveGroupId = nextActiveGroupId;
	}
	return result;
}

export function insertTabAt(
	tree: WorkbenchTree,
	targetGroupId: string,
	zone: 'left' | 'right' | 'top' | 'bottom' | 'full',
	tab: EditorTab
): WorkbenchTree {
	const draft = cloneTree(tree);
	const loc = findGroup(draft, targetGroupId);
	if (!loc.node || !isTabGroupNode(loc.node)) {
		return draft;
	}
	if (zone === 'full') {
		// Append to the same group
		loc.node.tabs = [...loc.node.tabs, tab];
		loc.node.activeTabId = tab.id;
		return draft;
	}
	// Determine desired orientation
	const desiredOrientation: Orientation = zone === 'left' || zone === 'right' ? 'vertical' : 'horizontal';

	// Path parent container
	const parentContainer =
		loc.parent ?? ({ id: 'root', orientation: draft.orientation, groups: draft.groups } as ContainerGroupNode);
	const isRootParent = loc.parent === null;

	// If parent already has desired orientation → insert sibling
	if (parentContainer.orientation === desiredOrientation) {
		const newGroup: TabGroupNode = { id: generateId('group'), tabs: [tab], activeTabId: tab.id };
		const insertIndex = zone === 'left' || zone === 'top' ? loc.indexInParent : loc.indexInParent + 1;
		parentContainer.groups.splice(insertIndex, 0, newGroup);
		if (isRootParent) {
			// reflect back to tree groups
			draft.groups = parentContainer.groups;
		}
		return draft;
	}

	// Otherwise wrap the target group in a container with desired orientation
	const wrapper: ContainerGroupNode = {
		id: generateId(desiredOrientation === 'vertical' ? 'v' : 'h'),
		orientation: desiredOrientation,
		groups: []
	};
	const newGroup: TabGroupNode = { id: generateId('group'), tabs: [tab], activeTabId: tab.id };
	if (zone === 'left' || zone === 'top') {
		const current = cloneNode(loc.node);
		wrapper.groups = [newGroup, current];
	} else {
		const current = cloneNode(loc.node);
		wrapper.groups = [current, newGroup];
	}
	if (isRootParent) {
		parentContainer.groups.splice(loc.indexInParent, 1, wrapper);
		draft.groups = parentContainer.groups;
	} else if (loc.parent) {
		loc.parent.groups.splice(loc.indexInParent, 1, wrapper);
	}
	return draft;
}

export function normalizeTree(tree: WorkbenchTree): WorkbenchTree {
	const cleanup = (node: GroupNode): GroupNode | null => {
		if (isTabGroupNode(node)) {
			// Drop empty tab groups
			if (node.tabs.length === 0) return null;
			return node;
		}
		// normalize children
		const children = node.groups.map(g => cleanup(g)).filter((n): n is GroupNode => n !== null);
		if (children.length === 0) {
			// empty container disappears
			return null;
		}
		if (children.length === 1) {
			// flatten single-child containers
			const onlyChild = children[0];
			if (onlyChild) return onlyChild;
			return null;
		}
		return { ...node, groups: children };
	};

	const rootChildren = tree.groups.map(g => cleanup(g)).filter((n): n is GroupNode => n !== null);
	const result: WorkbenchTree = { ...tree, groups: rootChildren };
	// If root has only one child container and its orientation differs from root,
	// we still keep the root orientation as-is; it only affects top-level splitters.
	return result;
}

/**
 * Move a tab to the adjacent tab group in the given direction, creating a
 * new group when none exists but the source still has other tabs to keep.
 * Returns the tree unchanged when the source has only one tab *and* there
 * is no existing destination — that case is a no-op because relocating
 * the single tab would just rename its group without changing layout.
 *
 * The function also returns the destination group id so the caller can
 * move focus onto the new location.
 */
export function moveTabToAdjacentGroup(
	tree: WorkbenchTree,
	fromGroupId: string,
	tabId: string,
	direction: 'left' | 'right'
): { tree: WorkbenchTree; destGroupId: string | null } {
	const sourceLoc = findGroup(tree, fromGroupId);
	if (!sourceLoc.node || !isTabGroupNode(sourceLoc.node)) {
		return { tree, destGroupId: null };
	}
	const sourceGroup = sourceLoc.node;
	const tab = sourceGroup.tabs.find(t => t.id === tabId);
	if (!tab) return { tree, destGroupId: null };

	// Determine the parent container — fall back to a virtual root when at top.
	const parentOrientation = sourceLoc.parent
		? sourceLoc.parent.orientation
		: tree.orientation;
	const parentGroups = sourceLoc.parent ? sourceLoc.parent.groups : tree.groups;

	// `vertical` sash orientation = groups arranged side-by-side (horizontal layout).
	if (parentOrientation === 'vertical') {
		const siblingIdx = direction === 'left' ? sourceLoc.indexInParent - 1 : sourceLoc.indexInParent + 1;
		const sibling = parentGroups[siblingIdx];
		if (sibling && isTabGroupNode(sibling)) {
			const { tree: afterRemove } = removeTab(tree, fromGroupId, tabId);
			return { tree: insertTabAt(afterRemove, sibling.id, 'full', tab), destGroupId: sibling.id };
		}
	}

	// No existing adjacent group at the right orientation: skip if the
	// source would end up empty (the move would be invisible).
	if (sourceGroup.tabs.length <= 1) return { tree, destGroupId: null };

	const { tree: afterRemove } = removeTab(tree, fromGroupId, tabId);
	// `removeTab` normalises; the source still exists because it had >1 tab.
	// `insertTabAt` with a zone creates a fresh sibling group and handles the
	// wrap-in-container case when the parent orientation doesn't match yet.
	const next = insertTabAt(afterRemove, fromGroupId, direction, tab);
	// The new group id is generated inside insertTabAt — locate it by finding
	// the group that now owns our tab.
	const newLoc = findGroupContainingTab(next, tab.id);
	return { tree: next, destGroupId: newLoc };
}

/** Walk the tree to find the id of the group currently containing `tabId`. */
function findGroupContainingTab(tree: WorkbenchTree, tabId: string): string | null {
	const rec = (nodes: GroupNode[]): string | null => {
		for (const n of nodes) {
			if (isTabGroupNode(n)) {
				if (n.tabs.some(t => t.id === tabId)) return n.id;
			} else if (isContainerNode(n)) {
				const found = rec(n.groups);
				if (found) return found;
			}
		}
		return null;
	};
	return rec(tree.groups);
}
