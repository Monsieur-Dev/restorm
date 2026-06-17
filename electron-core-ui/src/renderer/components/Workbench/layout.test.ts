import { describe, it, expect } from 'vitest';
import { serializeWorkbenchLayout, applyWorkbenchLayout, type WorkbenchLayout, type LayoutTab, type TabSerializer } from './layout';
import { removeTab } from './tree';
import { isTabGroupNode, type EditorTab, type WorkbenchTree } from './types';

/**
 * Build a minimal `EditorTab`. The serializer below reads `id` +
 * `titleString` + a stashed `tabType` / `itemId` carried in
 * `persistedState`, so the test exercises the generic resolver contract
 * without depending on any host app's tab shape.
 */
function tab(id: string, opts: { tabType?: string; itemId?: string | null; title?: string; data?: unknown } = {}): EditorTab {
	const t: EditorTab = { id, title: opts.title ?? id, titleString: opts.title ?? id };
	const meta: Record<string, unknown> = {};
	if (opts.tabType !== undefined) meta['tabType'] = opts.tabType;
	if (opts.itemId !== undefined) meta['itemId'] = opts.itemId;
	if (opts.data !== undefined) meta['userData'] = opts.data;
	t.persistedState = meta;
	return t;
}

const serializeTab: TabSerializer = (t: EditorTab) => {
	const meta = (t.persistedState ?? {}) as Record<string, unknown>;
	return {
		tabType: typeof meta['tabType'] === 'string' ? meta['tabType'] : undefined,
		title: t.titleString ?? '',
		itemId: (meta['itemId'] as string | null | undefined) ?? null,
		data: meta['userData']
	};
};

// Rebuild a fresh tab from the descriptor — restores tabType / itemId /
// data into persistedState the same way the serializer reads them, so a
// re-serialize is structurally identical.
const rebuildTab = (lt: LayoutTab): EditorTab | null => {
	const meta: Record<string, unknown> = {};
	if (lt.tabType !== undefined) meta['tabType'] = lt.tabType;
	if (lt.itemId !== undefined && lt.itemId !== null) meta['itemId'] = lt.itemId;
	if (lt.data !== undefined) meta['userData'] = lt.data;
	return { id: lt.id, title: lt.title, titleString: lt.title, persistedState: meta };
};

/** Drop the volatile `data`/persistedState for a pure structural compare. */
function structural(layout: WorkbenchLayout): unknown {
	const stripNode = (n: WorkbenchLayout['groups'][number]): unknown => {
		if (n.kind === 'tabs') {
			return {
				kind: n.kind,
				id: n.id,
				activeTabId: n.activeTabId,
				tabs: n.tabs.map((t) => ({ id: t.id, tabType: t.tabType, title: t.title, itemId: t.itemId }))
			};
		}
		return { kind: n.kind, id: n.id, orientation: n.orientation, sizes: n.sizes, groups: n.groups.map(stripNode) };
	};
	return {
		orientation: layout.orientation,
		sizes: layout.sizes,
		focusedGroupId: layout.focusedGroupId,
		maximizedTabId: layout.maximizedTabId,
		groups: layout.groups.map(stripNode)
	};
}

describe('serializeWorkbenchLayout / applyWorkbenchLayout', () => {
	it('serializes a single-group tree with mixed tab types', () => {
		const tree: WorkbenchTree = {
			orientation: 'vertical',
			groups: [
				{
					id: 'g1',
					activeTabId: 'r1',
					tabs: [
						tab('r1', { tabType: 'http-request', itemId: 'req-1', title: 'Get pet' }),
						tab('console:singleton', { tabType: 'console', itemId: null, title: 'Console' })
					]
				}
			]
		};
		const layout = serializeWorkbenchLayout(tree, serializeTab, { focusedGroupId: 'g1', maximizedTabId: null });
		expect(layout.orientation).toBe('vertical');
		expect(layout.focusedGroupId).toBe('g1');
		expect(layout.maximizedTabId).toBeNull();
		const g = layout.groups[0];
		expect(g?.kind).toBe('tabs');
		if (g?.kind === 'tabs') {
			expect(g.activeTabId).toBe('r1');
			expect(g.tabs[0]).toMatchObject({ id: 'r1', tabType: 'http-request', itemId: 'req-1', title: 'Get pet' });
			expect(g.tabs[1]).toMatchObject({ id: 'console:singleton', tabType: 'console', itemId: null });
		}
	});

	it('serializes split containers with orientation + sizes', () => {
		const tree: WorkbenchTree = {
			orientation: 'vertical',
			sizes: [0.6, 0.4],
			groups: [
				{ id: 'left', activeTabId: 'a', tabs: [tab('a', { tabType: 'folder', itemId: 'f1' })] },
				{
					id: 'rightContainer',
					orientation: 'horizontal',
					sizes: [0.3, 0.7],
					groups: [
						{ id: 'top', activeTabId: 'b', tabs: [tab('b', { tabType: 'http-request', itemId: 'r2' })] },
						{ id: 'bottom', activeTabId: 'c', tabs: [tab('c', { tabType: 'scenario-editor', itemId: 's1' })] }
					]
				}
			]
		};
		const layout = serializeWorkbenchLayout(tree, serializeTab);
		expect(layout.sizes).toEqual([0.6, 0.4]);
		const container = layout.groups[1];
		expect(container?.kind).toBe('container');
		if (container?.kind === 'container') {
			expect(container.orientation).toBe('horizontal');
			expect(container.sizes).toEqual([0.3, 0.7]);
			expect(container.groups).toHaveLength(2);
		}
	});

	it('round-trips: serialize -> apply -> serialize is structurally equal', () => {
		const tree: WorkbenchTree = {
			orientation: 'vertical',
			sizes: [0.5, 0.5],
			groups: [
				{ id: 'left', activeTabId: 'a', tabs: [tab('a', { tabType: 'folder', itemId: 'f1' }), tab('a2', { tabType: 'http-request', itemId: 'r9' })] },
				{
					id: 'rc',
					orientation: 'horizontal',
					sizes: [0.4, 0.6],
					groups: [
						{ id: 'top', activeTabId: 'b', tabs: [tab('b', { tabType: 'http-request', itemId: 'r2' })] },
						{ id: 'bottom', activeTabId: 'mini-browser:singleton', tabs: [tab('mini-browser:singleton', { tabType: 'mini-browser', itemId: null, data: { url: 'https://x' } })] }
					]
				}
			]
		};
		const first = serializeWorkbenchLayout(tree, serializeTab, { focusedGroupId: 'left', maximizedTabId: null });
		const applied = applyWorkbenchLayout(first, rebuildTab);
		const second = serializeWorkbenchLayout(applied.tree, serializeTab, {
			focusedGroupId: applied.focusedGroupId ?? null,
			maximizedTabId: applied.maximizedTabId ?? null
		});
		expect(structural(second)).toEqual(structural(first));
	});

	it('round-trips per-tab data (e.g. mini-browser url)', () => {
		const tree: WorkbenchTree = {
			orientation: 'vertical',
			groups: [{ id: 'g', activeTabId: 'mb', tabs: [tab('mb', { tabType: 'mini-browser', itemId: null, data: { url: 'https://example.com' } })] }]
		};
		const layout = serializeWorkbenchLayout(tree, serializeTab);
		expect(layout.groups[0]).toMatchObject({ kind: 'tabs' });
		const applied = applyWorkbenchLayout(layout, rebuildTab);
		const g = applied.tree.groups[0];
		expect(g && 'tabs' in g && g.tabs[0]?.persistedState).toMatchObject({ userData: { url: 'https://example.com' } });
	});

	it('drops tabs the rebuilder rejects and prunes empty groups / containers', () => {
		const layout: WorkbenchLayout = {
			orientation: 'vertical',
			sizes: [0.5, 0.5],
			groups: [
				{ kind: 'tabs', id: 'survivor', activeTabId: 'keep', tabs: [{ id: 'keep', tabType: 'http-request', itemId: 'ok', title: 'ok' }] },
				{ kind: 'tabs', id: 'doomed', activeTabId: 'gone', tabs: [{ id: 'gone', tabType: 'http-request', itemId: 'deleted', title: 'gone' }] }
			]
		};
		const applied = applyWorkbenchLayout(layout, (lt) => (lt.itemId === 'deleted' ? null : rebuildTab(lt)));
		expect(applied.tree.groups).toHaveLength(1);
		expect(applied.tree.groups[0]?.id).toBe('survivor');
		// sizes dropped because the child count changed
		expect(applied.tree.sizes).toBeUndefined();
	});

	it('repairs activeTabId when the active tab was dropped', () => {
		const layout: WorkbenchLayout = {
			orientation: 'vertical',
			groups: [
				{
					kind: 'tabs',
					id: 'g',
					activeTabId: 'gone',
					tabs: [
						{ id: 'gone', tabType: 'http-request', itemId: 'deleted', title: 'gone' },
						{ id: 'keep', tabType: 'http-request', itemId: 'ok', title: 'ok' }
					]
				}
			]
		};
		const applied = applyWorkbenchLayout(layout, (lt) => (lt.itemId === 'deleted' ? null : rebuildTab(lt)));
		const g = applied.tree.groups[0];
		expect(g && 'tabs' in g && g.activeTabId).toBe('keep');
	});

	it('validates focusedGroupId / maximizedTabId against survivors', () => {
		const layout: WorkbenchLayout = {
			orientation: 'vertical',
			focusedGroupId: 'missing-group',
			maximizedTabId: 'missing-tab',
			groups: [{ kind: 'tabs', id: 'g', activeTabId: 'a', tabs: [{ id: 'a', tabType: 'folder', itemId: 'f', title: 'f' }] }]
		};
		const applied = applyWorkbenchLayout(layout, rebuildTab);
		expect(applied.focusedGroupId).toBeNull();
		expect(applied.maximizedTabId).toBeNull();
	});

	// A side-by-side 2-group split is exactly the layout an automation
	// client can't build via drag & drop — this proves `applyWorkbenchLayout`
	// reconstructs it deterministically, then reproduces the
	// close-active-returns-to-MRU-in-the-other-group scenario.
	it('reconstructs a 2-group split and reproduces a cross-group close', () => {
		const twoGroup: WorkbenchLayout = {
			orientation: 'vertical',
			sizes: [0.5, 0.5],
			focusedGroupId: 'right',
			groups: [
				{
					kind: 'tabs',
					id: 'left',
					activeTabId: 'r1',
					tabs: [
						{ id: 'r1', tabType: 'http-request', title: 'r1', itemId: 'r1' },
						{ id: 'r2', tabType: 'http-request', title: 'r2', itemId: 'r2' }
					]
				},
				{
					kind: 'tabs',
					id: 'right',
					activeTabId: 'r3',
					tabs: [
						{ id: 'r3', tabType: 'http-request', title: 'r3', itemId: 'r3' },
						{ id: 'console:singleton', tabType: 'console', title: 'Console', itemId: null }
					]
				}
			]
		};
		const applied = applyWorkbenchLayout(twoGroup, rebuildTab);
		expect(applied.tree.groups).toHaveLength(2);
		expect(applied.tree.sizes).toEqual([0.5, 0.5]);
		expect(applied.focusedGroupId).toBe('right');
		const [left, right] = applied.tree.groups;
		expect(left && isTabGroupNode(left) && left.tabs.map((t) => t.id)).toEqual(['r1', 'r2']);
		expect(right && isTabGroupNode(right) && right.tabs.map((t) => t.id)).toEqual(['r3', 'console:singleton']);
		expect(right && isTabGroupNode(right) && right.activeTabId).toBe('r3');

		// Close the active tab in the RIGHT group; the MRU resolver picks a
		// tab in the LEFT group — the cross-group behaviour, now reproducible
		// without drag & drop.
		const { tree, nextActiveGroupId } = removeTab(applied.tree, 'right', 'r3', () => 'r1');
		expect(nextActiveGroupId).toBe('left');
		const closedLeft = tree.groups.find((g) => g.id === 'left');
		expect(closedLeft && isTabGroupNode(closedLeft) && closedLeft.activeTabId).toBe('r1');
	});

	it('flattens a container down to its single surviving child', () => {
		const layout: WorkbenchLayout = {
			orientation: 'vertical',
			groups: [
				{
					kind: 'container',
					id: 'c',
					orientation: 'horizontal',
					sizes: [0.5, 0.5],
					groups: [
						{ kind: 'tabs', id: 'top', activeTabId: 'x', tabs: [{ id: 'x', tabType: 'http-request', itemId: 'gone', title: 'x' }] },
						{ kind: 'tabs', id: 'bottom', activeTabId: 'y', tabs: [{ id: 'y', tabType: 'http-request', itemId: 'ok', title: 'y' }] }
					]
				}
			]
		};
		const applied = applyWorkbenchLayout(layout, (lt) => (lt.itemId === 'gone' ? null : rebuildTab(lt)));
		// The container collapses to just the 'bottom' tab group.
		expect(applied.tree.groups).toHaveLength(1);
		expect(applied.tree.groups[0]?.id).toBe('bottom');
	});

	// Singletons: the rebuilder returns a tab whose id is the CANONICAL id
	// (e.g. `firewall:singleton`), which may differ from the caller-supplied
	// spec id (e.g. `firewall-singleton`). The activeTabId in the spec points
	// at the spec id — the map must resolve it to the canonical id so the
	// singleton becomes the active tab.
	it('resolves singleton activeTabId through the spec→canonical id map', () => {
		// A rebuilder that returns a tab with a canonical id distinct from the spec id.
		// This mirrors how restorm's `resolveRebuildTabId` maps `tabType: 'firewall'`
		// → `FIREWALL_TAB_ID = 'firewall:singleton'` regardless of the spec `id`.
		const canonicalId = 'firewall:singleton';
		const rebuildSingleton = (lt: LayoutTab): EditorTab | null => {
			if (lt.tabType === 'firewall') {
				// Canonical id differs from spec id — the fix must bridge this gap.
				return { id: canonicalId, title: lt.title, titleString: lt.title };
			}
			return rebuildTab(lt);
		};

		const layout: WorkbenchLayout = {
			orientation: 'vertical',
			groups: [
				{
					kind: 'tabs',
					id: 'g',
					// Caller sets the spec id as activeTabId (not the canonical id).
					activeTabId: 'firewall-singleton',
					tabs: [
						{ id: 'r1', tabType: 'http-request', itemId: 'req-1', title: 'GET /ping' },
						{ id: 'firewall-singleton', tabType: 'firewall', itemId: null, title: 'Firewall' }
					]
				}
			]
		};

		const applied = applyWorkbenchLayout(layout, rebuildSingleton);
		const g = applied.tree.groups[0];
		expect(g && 'tabs' in g && g.tabs.map((t) => t.id)).toEqual(['r1', canonicalId]);
		// The singleton must be the active tab, resolved through the spec→canonical map.
		expect(g && 'tabs' in g && g.activeTabId).toBe(canonicalId);
	});

	it('tree-backed activeTabId resolution is unchanged after the singleton fix', () => {
		// Tree-backed tabs: rebuilt id equals the spec id — existing behaviour preserved.
		const layout: WorkbenchLayout = {
			orientation: 'vertical',
			groups: [
				{
					kind: 'tabs',
					id: 'g',
					activeTabId: 'r2',
					tabs: [
						{ id: 'r1', tabType: 'http-request', itemId: 'req-1', title: 'R1' },
						{ id: 'r2', tabType: 'http-request', itemId: 'req-2', title: 'R2' }
					]
				}
			]
		};
		const applied = applyWorkbenchLayout(layout, rebuildTab);
		const g = applied.tree.groups[0];
		expect(g && 'tabs' in g && g.activeTabId).toBe('r2');
	});

	it('falls back to first tab when singleton spec activeTabId was dropped by the rebuilder', () => {
		// Singleton tab rejected by rebuilder → activeTabId must fall back, not crash.
		const layout: WorkbenchLayout = {
			orientation: 'vertical',
			groups: [
				{
					kind: 'tabs',
					id: 'g',
					activeTabId: 'firewall-singleton',
					tabs: [
						{ id: 'r1', tabType: 'http-request', itemId: 'req-1', title: 'R1' },
						{ id: 'firewall-singleton', tabType: 'firewall', itemId: null, title: 'Firewall' }
					]
				}
			]
		};
		// Rebuilder drops the firewall tab.
		const applied = applyWorkbenchLayout(layout, (lt) => (lt.tabType === 'firewall' ? null : rebuildTab(lt)));
		const g = applied.tree.groups[0];
		// Firewall dropped → only r1 survives; active falls back to r1.
		expect(g && 'tabs' in g && g.tabs).toHaveLength(1);
		expect(g && 'tabs' in g && g.activeTabId).toBe('r1');
	});
});
