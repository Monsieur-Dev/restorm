import type { ContainerGroupNode, EditorTab, GroupNode, Orientation, TabGroupNode, WorkbenchTree } from './types';
import { isContainerNode, isTabGroupNode } from './types';

/**
 * Serializable, React-free description of a workbench layout.
 *
 * `WorkbenchTree` carries `EditorTab.title` / `content` as live React
 * nodes, so it can't cross an IPC boundary or be inspected by an
 * automation client. This shape mirrors the tree's structure (split
 * tree + per-split orientation + sash sizes + per-group ordered tabs +
 * active tab) but replaces each tab with a flat, JSON-safe descriptor.
 *
 * The module is deliberately generic: it knows nothing about any
 * particular host app's tab types. Callers inject a {@link TabSerializer}
 * to turn an `EditorTab` into a {@link LayoutTab}, and a
 * {@link TabRebuilder} to turn a {@link LayoutTab} back into a live
 * `EditorTab` (opening singletons / tree-backed items as needed).
 */
export interface WorkbenchLayout {
	/** Root split orientation. `vertical` = side-by-side, `horizontal` = stacked. */
	orientation: Orientation;
	/** Sash ratios (0-1) for the root-level groups, when split. */
	sizes?: number[] | undefined;
	/** Id of the group that currently holds focus (or null). */
	focusedGroupId?: string | null | undefined;
	/** Id of the tab currently maximized into the fullscreen modal (or null). */
	maximizedTabId?: string | null | undefined;
	/** The hierarchical group / split tree. */
	groups: LayoutNode[];
}

export type LayoutNode = LayoutTabGroup | LayoutContainer;

/** A leaf group: an ordered list of tabs + the active one. */
export interface LayoutTabGroup {
	kind: 'tabs';
	id: string;
	activeTabId?: string | undefined;
	tabs: LayoutTab[];
}

/** A split container: child groups arranged along one orientation. */
export interface LayoutContainer {
	kind: 'container';
	id: string;
	orientation: Orientation;
	sizes?: number[] | undefined;
	groups: LayoutNode[];
}

/**
 * Flat, JSON-safe descriptor for a single tab.
 *
 * `tabType` is the host's discriminator (e.g. `'http-request'`,
 * `'folder'`, `'console'`); this module treats it as an opaque string.
 * `itemId` identifies a tree-backed tab (request / folder / scenario id)
 * for re-opening; it's `null` for singleton special tabs, which are
 * re-opened by `tabType` instead. `data` round-trips any opt-in per-tab
 * persisted state (e.g. a mini-browser's current url) so an apply can
 * restore it.
 */
export interface LayoutTab {
	id: string;
	tabType?: string | undefined;
	title: string;
	itemId?: string | null | undefined;
	/** Opaque, JSON-serialisable per-tab state (mirrors `EditorTab.persistedState`). */
	data?: unknown;
}

export function isLayoutTabGroup(node: LayoutNode): node is LayoutTabGroup {
	return node.kind === 'tabs';
}

export function isLayoutContainer(node: LayoutNode): node is LayoutContainer {
	return node.kind === 'container';
}

/**
 * Host-supplied mapping from a live `EditorTab` to its flat descriptor.
 * Returns the `tabType`, a serialisable `title`, and the `itemId` for
 * tree-backed tabs (null for singletons). `data` defaults to the tab's
 * `persistedState` when omitted.
 */
export type TabSerializer = (tab: EditorTab) => {
	tabType?: string | undefined;
	title: string;
	itemId?: string | null | undefined;
	data?: unknown;
};

/**
 * Serialize a live `WorkbenchTree` into the React-free
 * {@link WorkbenchLayout} shape.
 *
 * `focusedGroupId` / `maximizedTabId` are workbench-level state the tree
 * itself doesn't carry, so the caller threads them in.
 */
export function serializeWorkbenchLayout(
	tree: WorkbenchTree,
	serializeTab: TabSerializer,
	state?: { focusedGroupId?: string | null; maximizedTabId?: string | null }
): WorkbenchLayout {
	const serializeNode = (node: GroupNode): LayoutNode => {
		if (isTabGroupNode(node)) {
			const group: LayoutTabGroup = {
				kind: 'tabs',
				id: node.id,
				tabs: node.tabs.map((tab) => {
					const mapped = serializeTab(tab);
					const layoutTab: LayoutTab = {
						id: tab.id,
						title: mapped.title,
						tabType: mapped.tabType,
						itemId: mapped.itemId ?? null
					};
					const data = mapped.data ?? tab.persistedState;
					if (data !== undefined && data !== null) layoutTab.data = data;
					return layoutTab;
				})
			};
			if (node.activeTabId !== undefined) group.activeTabId = node.activeTabId;
			return group;
		}
		const container: LayoutContainer = {
			kind: 'container',
			id: node.id,
			orientation: node.orientation,
			groups: node.groups.map(serializeNode)
		};
		if (node.sizes !== undefined) container.sizes = [...node.sizes];
		return container;
	};

	const layout: WorkbenchLayout = {
		orientation: tree.orientation,
		groups: tree.groups.map(serializeNode)
	};
	if (tree.sizes !== undefined) layout.sizes = [...tree.sizes];
	if (state?.focusedGroupId !== undefined) layout.focusedGroupId = state.focusedGroupId;
	if (state?.maximizedTabId !== undefined) layout.maximizedTabId = state.maximizedTabId;
	return layout;
}

/**
 * Host-supplied rebuilder: turn a flat {@link LayoutTab} into a live
 * `EditorTab`, opening / reconstructing whatever it backs (a tree item
 * by `itemId`, a singleton special by `tabType`). Return `null` to drop
 * a tab that can't be reconstructed (e.g. its item was deleted) — the
 * apply prunes it and any group it would have emptied.
 */
export type TabRebuilder = (tab: LayoutTab) => EditorTab | null;

/** The reconstructed tree plus the workbench-level state to re-apply. */
export interface AppliedWorkbenchLayout {
	tree: WorkbenchTree;
	focusedGroupId?: string | null | undefined;
	maximizedTabId?: string | null | undefined;
}

/**
 * Rebuild a live `WorkbenchTree` from a {@link WorkbenchLayout} spec.
 *
 * Mirrors `rebuildWorkbenchTree` (the persistence restore path) but
 * works from the richer layout shape: it reconstructs each tab via
 * `rebuildTab`, drops tabs that can't be rebuilt, prunes the empty
 * groups / single-child containers they leave behind, and repairs each
 * group's `activeTabId` to a tab that actually survived. Returns the
 * tree plus the `focusedGroupId` / `maximizedTabId` to apply (each
 * validated against the surviving tabs / groups).
 *
 * Returns a tree with an empty `groups` array when nothing survives —
 * the caller decides whether that means "clear the workbench".
 */
export function applyWorkbenchLayout(
	layout: WorkbenchLayout,
	rebuildTab: TabRebuilder
): AppliedWorkbenchLayout {
	const rebuildNode = (node: LayoutNode): GroupNode | null => {
		if (isLayoutTabGroup(node)) {
			const tabs: EditorTab[] = [];
			// Map each spec tab's id to the reconstructed tab's canonical id.
			// Singleton tabs get a stable canonical id (e.g. `firewall:singleton`)
			// from the rebuilder, which may differ from the caller-supplied spec id
			// (e.g. `firewall-singleton`). We resolve `activeTabId` through this
			// map so a spec `activeTabId` pointing at a singleton's spec-id finds
			// its canonical counterpart.
			const specIdToRebuiltId = new Map<string, string>();
			for (const layoutTab of node.tabs) {
				const tab = rebuildTab(layoutTab);
				if (tab) {
					tabs.push(tab);
					specIdToRebuiltId.set(layoutTab.id, tab.id);
				}
			}
			if (tabs.length === 0) return null;
			const firstTab = tabs[0];
			if (!firstTab) return null;
			// Resolve the spec activeTabId → canonical id (handles singletons whose
			// rebuilt id differs from their spec id), then verify the resolved id
			// actually survived the rebuild.
			const resolvedActiveId =
				node.activeTabId !== undefined ? (specIdToRebuiltId.get(node.activeTabId) ?? node.activeTabId) : undefined;
			const group: TabGroupNode = {
				id: node.id,
				tabs,
				activeTabId:
					resolvedActiveId !== undefined && tabs.some((t) => t.id === resolvedActiveId)
						? resolvedActiveId
						: firstTab.id
			};
			return group;
		}
		const children: GroupNode[] = [];
		for (const child of node.groups) {
			const rebuilt = rebuildNode(child);
			if (rebuilt) children.push(rebuilt);
		}
		if (children.length === 0) return null;
		// Flatten a container that lost all but one child — a lone child
		// doesn't need a split wrapper around it.
		if (children.length === 1) {
			const only = children[0];
			return only ?? null;
		}
		const container: ContainerGroupNode = {
			id: node.id,
			orientation: node.orientation,
			groups: children
		};
		// Keep the sizes aligned with the surviving children: when every
		// child made it through, reuse the spec's ratios; otherwise drop
		// them and let the workbench distribute evenly.
		if (node.sizes?.length === node.groups.length && children.length === node.groups.length) {
			container.sizes = [...node.sizes];
		}
		return container;
	};

	const groups: GroupNode[] = [];
	for (const node of layout.groups) {
		const rebuilt = rebuildNode(node);
		if (rebuilt) groups.push(rebuilt);
	}

	const tree: WorkbenchTree = { orientation: layout.orientation, groups };
	if (layout.sizes?.length === layout.groups.length && groups.length === layout.groups.length) {
		tree.sizes = [...layout.sizes];
	}

	const result: AppliedWorkbenchLayout = { tree };
	// Validate focus against a group that survived the rebuild.
	if (layout.focusedGroupId !== undefined && layout.focusedGroupId !== null) {
		result.focusedGroupId = groupExists(groups, layout.focusedGroupId) ? layout.focusedGroupId : null;
	} else if (layout.focusedGroupId === null) {
		result.focusedGroupId = null;
	}
	// Validate the maximized tab against a tab that survived (and opted in).
	if (layout.maximizedTabId !== undefined && layout.maximizedTabId !== null) {
		result.maximizedTabId = tabExists(groups, layout.maximizedTabId) ? layout.maximizedTabId : null;
	} else if (layout.maximizedTabId === null) {
		result.maximizedTabId = null;
	}
	return result;
}

function groupExists(nodes: GroupNode[], groupId: string): boolean {
	for (const node of nodes) {
		if ((node as TabGroupNode | ContainerGroupNode).id === groupId) return true;
		if (isContainerNode(node) && groupExists(node.groups, groupId)) return true;
	}
	return false;
}

function tabExists(nodes: GroupNode[], tabId: string): boolean {
	for (const node of nodes) {
		if (isTabGroupNode(node)) {
			if (node.tabs.some((t) => t.id === tabId)) return true;
		} else if (isContainerNode(node) && tabExists(node.groups, tabId)) {
			return true;
		}
	}
	return false;
}
