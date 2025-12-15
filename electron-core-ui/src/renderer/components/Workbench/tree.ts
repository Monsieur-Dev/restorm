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

export function cloneNode<T extends GroupNode>(node: T): T {
	return JSON.parse(JSON.stringify(node)) as T;
}

export function cloneTree(tree: WorkbenchTree): WorkbenchTree {
	return JSON.parse(JSON.stringify(tree)) as WorkbenchTree;
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

export function removeTab(tree: WorkbenchTree, fromGroupId: string, tabId: string): { tree: WorkbenchTree; tab?: EditorTab } {
	const draft = cloneTree(tree);
	const loc = findGroup(draft, fromGroupId);
	if (!loc.node || !isTabGroupNode(loc.node)) {
		return { tree: draft };
	}
	const tab = loc.node.tabs.find(t => t.id === tabId);
	loc.node.tabs = loc.node.tabs.filter(t => t.id !== tabId);
	if (loc.node.activeTabId === tabId) {
		if (loc.node.tabs[0]) {
			loc.node.activeTabId = loc.node.tabs[0].id;
		} else {
			delete (loc.node as { activeTabId?: string }).activeTabId;
		}
	}
	const normalized = normalizeTree(draft);
	return tab ? { tree: normalized, tab } : { tree: normalized };
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
