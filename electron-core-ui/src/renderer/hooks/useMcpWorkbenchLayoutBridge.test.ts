// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMcpWorkbenchLayoutBridge, type UseMcpWorkbenchLayoutBridgeInput, type WorkbenchLayoutBridgeApi } from './useMcpWorkbenchLayoutBridge';
import type { WorkbenchLayout, TabSerializer, TabRebuilder } from '../components/Workbench/layout';
import type { EditorTab, WorkbenchTree } from '../components/Workbench/types';

const serializeTab: TabSerializer = (t: EditorTab) => ({
	tabType: 'http-request',
	title: t.titleString ?? '',
	itemId: t.id,
	data: undefined
});

const rebuildTab: TabRebuilder = (lt) => ({ id: lt.id, title: lt.title, titleString: lt.title });

function makeBridge(): WorkbenchLayoutBridgeApi & { fire: (layout: WorkbenchLayout) => void; pushed: WorkbenchLayout[] } {
	let cb: ((layout: WorkbenchLayout) => void) | null = null;
	const pushed: WorkbenchLayout[] = [];
	return {
		pushWorkbenchLayout: (layout) => { pushed.push(layout); },
		onMcpSetWorkbenchLayout: (fn) => { cb = fn; return () => { cb = null; }; },
		fire: (layout) => { cb?.(layout); },
		pushed
	};
}

const tree: WorkbenchTree = {
	orientation: 'vertical',
	groups: [{ id: 'g1', activeTabId: 'r1', tabs: [{ id: 'r1', title: 'r1', titleString: 'r1' }] }]
};

/** Render the hook with sensible defaults + the given overrides. */
function render(overrides: Partial<UseMcpWorkbenchLayoutBridgeInput>): void {
	const input: UseMcpWorkbenchLayoutBridgeInput = {
		enabled: true,
		bridge: makeBridge(),
		tree,
		focusedGroupId: 'g1',
		maximizedTabId: null,
		serializeTab,
		rebuildTab,
		setWorkbenchTree: vi.fn(),
		setFocusedGroupId: vi.fn(),
		setMaximizedTabId: vi.fn(),
		onTabActivate: vi.fn(),
		...overrides
	};
	renderHook(() => { useMcpWorkbenchLayoutBridge(input); });
}

describe('useMcpWorkbenchLayoutBridge', () => {
	it('pushes the serialized layout on the read side', () => {
		const bridge = makeBridge();
		render({ bridge });
		expect(bridge.pushed).toHaveLength(1);
		expect(bridge.pushed[0]).toMatchObject({ orientation: 'vertical', focusedGroupId: 'g1', maximizedTabId: null });
		expect(bridge.pushed[0]?.groups[0]?.kind).toBe('tabs');
	});

	it('does nothing when disabled', () => {
		const bridge = makeBridge();
		render({ bridge, enabled: false });
		expect(bridge.pushed).toHaveLength(0);
	});

	it('no-ops cleanly when the bridge is absent', () => {
		expect(() => { render({ bridge: null }); }).not.toThrow();
	});

	it('applies an incoming layout: swaps tree, focus, maximized, and re-activates the focused tab', () => {
		const bridge = makeBridge();
		const setWorkbenchTree = vi.fn();
		const setFocusedGroupId = vi.fn();
		const setMaximizedTabId = vi.fn();
		const onTabActivate = vi.fn();
		render({ bridge, setWorkbenchTree, setFocusedGroupId, setMaximizedTabId, onTabActivate });

		const spec: WorkbenchLayout = {
			orientation: 'vertical',
			sizes: [0.5, 0.5],
			focusedGroupId: 'right',
			maximizedTabId: 'r3',
			groups: [
				{ kind: 'tabs', id: 'left', activeTabId: 'r1', tabs: [{ id: 'r1', tabType: 'http-request', title: 'r1', itemId: 'r1' }] },
				{ kind: 'tabs', id: 'right', activeTabId: 'r3', tabs: [{ id: 'r3', tabType: 'http-request', title: 'r3', itemId: 'r3' }] }
			]
		};
		bridge.fire(spec);

		expect(setWorkbenchTree).toHaveBeenCalledTimes(1);
		const applied = setWorkbenchTree.mock.calls[0]?.[0] as WorkbenchTree;
		expect(applied.groups).toHaveLength(2);
		expect(setFocusedGroupId).toHaveBeenCalledWith('right');
		expect(setMaximizedTabId).toHaveBeenCalledWith('r3');
		// Focused group is 'right' → its active tab 'r3' is re-activated.
		expect(onTabActivate).toHaveBeenCalledWith('r3');
	});

	it('does not maximize when the spec omits maximizedTabId', () => {
		const bridge = makeBridge();
		const setMaximizedTabId = vi.fn();
		render({ bridge, setMaximizedTabId });
		bridge.fire({
			orientation: 'vertical',
			groups: [{ kind: 'tabs', id: 'g', activeTabId: 'a', tabs: [{ id: 'a', tabType: 'http-request', title: 'a', itemId: 'a' }] }]
		});
		expect(setMaximizedTabId).not.toHaveBeenCalled();
	});
});
