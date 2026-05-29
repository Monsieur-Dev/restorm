// @vitest-environment jsdom
/**
 * Regression tests for the workbench's tab-content ownership model,
 * run under React `StrictMode` — which is what the host apps mount the
 * tree in, and the only mode that surfaces the mount-time
 * simulated-unmount/remount double-invoke. The production E2E build
 * makes `<StrictMode>` inert, so these bugs are invisible to it; that
 * is exactly the gap this file closes.
 *
 * Each tab's content carries a `useEffect(..., [])` that logs every
 * mount and unmount. Under StrictMode a fresh mount logs
 * `mount, unmount, mount` (net: +1 connection). The invariant these
 * tests pin: re-rendering the tree, reordering a tab inside its group,
 * and moving a tab to another group must add NO further mount/unmount
 * entries — i.e. the tab's effects are never disconnected/reconnected
 * and its DOM is never detached:
 *
 *  - A `host.remove()` cleanup firing on StrictMode's simulated unmount
 *    would detach the content from the document (`isConnected` false).
 *  - Rendering the content-host portals in tree order would let a tab
 *    REORDER mark a portal fiber for a `Placement` move, which React
 *    handles by disconnecting + reconnecting that subtree's passive
 *    effects — re-running `@monaco-editor/react`'s mount effect against
 *    an already-disposed editor in the real app. The effect log catches
 *    that as extra `unmount`/`mount` pairs.
 */
import React, { StrictMode, useEffect, act } from 'react'
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { WorkbenchTree, EditorTab } from './types'
import { setEditorDragData, clearEditorDragData, isEditorDragEvent, DND_MIME } from './dnd'

// `EditorWorkbench` reaches into Electron-flavoured plumbing on mount
// (window bounds, drag IPC, persistence, settings) — none of it is
// relevant to tab-content relocation, so stub it out. `EditorTabs` (the
// tab strip) and `Sash` are stubbed too: this suite is about the
// content panes, not the chrome.
vi.mock('../../services/logger', () => ({
	logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))
vi.mock('./ipc', () => ({
	getCurrentWindowBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
	onWorkbenchTabDropped: () => () => { /* no-op unsubscribe */ }
}))
vi.mock('./persistence', () => ({
	saveWorkbenchState: vi.fn(() => Promise.resolve(true)),
	loadWorkbenchState: vi.fn(() => Promise.resolve(null)),
	clearWorkbenchState: vi.fn(() => Promise.resolve(true)),
	rebuildWorkbenchTree: vi.fn(() => null)
}))
vi.mock('../../hooks/useSettings', () => ({
	useSetting: () => [false, vi.fn()]
}))
vi.mock('../Sash', () => ({ Sash: () => null }))
vi.mock('./EditorTabs', () => ({ EditorTabs: () => <div data-testid="tabstrip" /> }))

import { EditorWorkbench } from './EditorWorkbench'

beforeAll(() => {
	// jsdom ships neither — `EditorGroupView` / embedded content may
	// construct one. A no-op stub is enough for these tests.
	if (!('ResizeObserver' in globalThis)) {
		;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
			observe(): void { /* no-op */ }
			unobserve(): void { /* no-op */ }
			disconnect(): void { /* no-op */ }
		}
	}
})

// Per-test effect log: `${event}:${tabId}` for every mount / unmount of
// a tab's content effect. Cleared per test.
const effectLog: string[] = []

// Tab content with a mount effect that logs its lifecycle — mimics
// `@monaco-editor/react` holding an editor instance across mount.
const TrackedContent: React.FC<{ tabId: string }> = ({ tabId }) => {
	useEffect(() => {
		effectLog.push(`mount:${tabId}`)
		return () => { effectLog.push(`unmount:${tabId}`) }
	}, [tabId])
	return <div data-testid={`content-${tabId}`}>{tabId}</div>
}

const tab = (id: string): EditorTab => ({ id, title: id, titleString: id })
const renderTabContent = (t: EditorTab): React.ReactNode => <TrackedContent tabId={t.id} />

/** `mount` minus `unmount` count for a tab — the net effect connections. */
function netConnections(tabId: string): number {
	const mounts = effectLog.filter((e) => e === `mount:${tabId}`).length
	const unmounts = effectLog.filter((e) => e === `unmount:${tabId}`).length
	return mounts - unmounts
}

/** Snapshot of `[mount, unmount]` counts for a tab. */
function lifecycle(tabId: string): [number, number] {
	return [
		effectLog.filter((e) => e === `mount:${tabId}`).length,
		effectLog.filter((e) => e === `unmount:${tabId}`).length
	]
}

describe('EditorWorkbench — tab content survives relocation (StrictMode)', () => {
	it('never disconnects/detaches a tab\'s content on re-render, in-group reorder, or cross-group move', () => {
		effectLog.length = 0
		const oneGroup = (tabs: EditorTab[], activeTabId: string): WorkbenchTree => ({
			orientation: 'vertical',
			groups: [{ id: 'g1', tabs, activeTabId }]
		})

		// Initial mount under StrictMode. The workbench is lazy-once: only
		// the active tab of each group is mounted initially. To exercise
		// the "both tabs survive a reorder / cross-group move" invariant
		// we first need to visit B so it gets materialised.
		const { rerender } = render(
			<StrictMode>
				<EditorWorkbench tree={oneGroup([tab('A'), tab('B')], 'A')} renderTabContent={renderTabContent} />
			</StrictMode>
		)
		// A (the active tab) is mounted, B is NOT yet (lazy-once policy).
		expect(screen.getByTestId('content-A').isConnected).toBe(true)
		expect(screen.queryByTestId('content-B'), 'B has never been active — must NOT be mounted yet').toBeNull()
		expect(netConnections('A')).toBe(1)
		expect(netConnections('B')).toBe(0)

		// Activate B → it materialises. After this point both should
		// survive the same invariants as the original test.
		rerender(
			<StrictMode>
				<EditorWorkbench tree={oneGroup([tab('A'), tab('B')], 'B')} renderTabContent={renderTabContent} />
			</StrictMode>
		)
		expect(screen.getByTestId('content-A').isConnected).toBe(true)
		expect(screen.getByTestId('content-B').isConnected).toBe(true)
		expect(netConnections('A')).toBe(1)
		expect(netConnections('B')).toBe(1)
		const afterMountA = lifecycle('A')
		const afterMountB = lifecycle('B')

		// In-group reorder: A and B swap places in `group.tabs`. The
		// content-host portals are id-sorted, so no portal fiber is
		// marked for a `Placement` move — no disconnect/reconnect.
		rerender(
			<StrictMode>
				<EditorWorkbench tree={oneGroup([tab('B'), tab('A')], 'A')} renderTabContent={renderTabContent} />
			</StrictMode>
		)
		expect(screen.getByTestId('content-A').isConnected).toBe(true)
		expect(screen.getByTestId('content-B').isConnected).toBe(true)
		expect(lifecycle('A'), 'A: in-group reorder must not disconnect the content effect').toEqual(afterMountA)
		expect(lifecycle('B'), 'B: in-group reorder must not disconnect the content effect').toEqual(afterMountB)

		// Cross-group move: A leaves g1 for a new group g2. Its host node
		// is relocated by `appendChild`; the React subtree is untouched.
		rerender(
			<StrictMode>
				<EditorWorkbench
					tree={{
						orientation: 'vertical',
						groups: [
							{ id: 'g1', tabs: [tab('B')], activeTabId: 'B' },
							{ id: 'g2', tabs: [tab('A')], activeTabId: 'A' }
						]
					}}
					renderTabContent={renderTabContent}
				/>
			</StrictMode>
		)
		expect(screen.getByTestId('content-A').isConnected).toBe(true)
		expect(screen.getByTestId('content-B').isConnected).toBe(true)
		expect(lifecycle('A'), 'A: cross-group move must not disconnect the content effect').toEqual(afterMountA)
		expect(lifecycle('B'), 'B: a sibling leaving the group must not disconnect the content effect').toEqual(afterMountB)
	})

	it('keeps content attached when a tab is opened into an already-mounted workbench', () => {
		// Bug repro: opening a tab mounts a `TabContentHost` *during an
		// update* (not as part of the workbench's own initial mount).
		// A `host.remove()` cleanup firing on StrictMode's simulated
		// unmount of that newly-mounted host detaches the content with
		// nothing re-attaching it — the tab renders blank.
		effectLog.length = 0
		const empty: WorkbenchTree = {
			orientation: 'vertical',
			groups: [{ id: 'g1', tabs: [] }]
		}
		const withTab: WorkbenchTree = {
			orientation: 'vertical',
			groups: [{ id: 'g1', tabs: [tab('A')], activeTabId: 'A' }]
		}

		const { rerender } = render(
			<StrictMode>
				<EditorWorkbench tree={empty} renderTabContent={renderTabContent} />
			</StrictMode>
		)
		// Open a tab into the already-mounted workbench.
		rerender(
			<StrictMode>
				<EditorWorkbench tree={withTab} renderTabContent={renderTabContent} />
			</StrictMode>
		)

		expect(
			screen.getByTestId('content-A').isConnected,
			'A must stay attached to the document when opened into a mounted workbench'
		).toBe(true)
		expect(netConnections('A'), 'A must end effect-connected exactly once').toBe(1)
	})

	it('routes drag events fired on portalled tab content to the group\'s split-drop handler', () => {
		// The tab content is portalled with `EditorWorkbench` as its
		// React parent, so React's *synthetic* drag events on the
		// content propagate to `EditorWorkbench`, never reaching this
		// group. The group's split-drop handlers are therefore attached
		// as native DOM listeners — DOM bubbling follows the real tree,
		// and the content's host node IS a DOM descendant of the
		// group's placeholder. This is the bug behind the split overlay
		// vanishing once the drag pointer crosses the half it entered.
		effectLog.length = 0
		// Mark an in-flight editor-tab drag so `isEditorDragEvent`
		// recognises the synthetic events below (the fixture event has
		// no real `DataTransfer`, so `dnd` falls back to this).
		setEditorDragData(
			{ dataTransfer: undefined } as unknown as React.DragEvent,
			{ editorId: 'A', sourceGroupId: 'g1' }
		)
		try {
			render(
				<StrictMode>
					<EditorWorkbench
						tree={{ orientation: 'vertical', groups: [{ id: 'g1', tabs: [tab('A'), tab('B')], activeTabId: 'A' }] }}
						renderTabContent={renderTabContent}
						data-testid="ewb"
					/>
				</StrictMode>
			)
			const placeholder = document.querySelector('[data-testid="ewb-group-g1-content"]')
			expect(placeholder, 'group content placeholder must render').not.toBeNull()
			expect(placeholder?.getAttribute('data-split-target')).toBe('')

			// A `dragover` fired ON the tab content (deep inside the
			// portal) must bubble through the DOM to the group's
			// placeholder listener and set a split target.
			const content = screen.getByTestId('content-A')
			act(() => {
				content.dispatchEvent(
					new MouseEvent('dragover', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 })
				)
			})
			expect(
				placeholder?.getAttribute('data-split-target'),
				'a dragover on portalled tab content must reach the group split-drop handler'
			).not.toBe('')
		} finally {
			clearEditorDragData()
		}
	})

	it('clears the editor-drag payload after a split-drop, so a later foreign drag is not mistaken for one', () => {
		// Dragging a tab to split moves it into the target group, so the source
		// tab unmounts during the drop and its `dragend` never fires. If the
		// module-level payload is not cleared on the drop, `isEditorDragEvent`'s
		// fallback keeps reporting `true` for the next (sidebar) drag — and the
		// split overlay then swallows drops meant for the editor content.
		setEditorDragData(
			{ dataTransfer: undefined } as unknown as React.DragEvent,
			{ editorId: 'A', sourceGroupId: 'g1' }
		)
		// Sanity: the fallback currently reports an in-flight editor drag.
		expect(isEditorDragEvent({ dataTransfer: undefined } as unknown as DragEvent)).toBe(true)
		try {
			render(
				<StrictMode>
					<EditorWorkbench
						tree={{ orientation: 'vertical', groups: [{ id: 'g1', tabs: [tab('A'), tab('B')], activeTabId: 'A' }] }}
						renderTabContent={renderTabContent}
						data-testid="ewb"
					/>
				</StrictMode>
			)
			const content = screen.getByTestId('content-A')
			const dataTransfer = {
				getData: (type: string) => (type === DND_MIME.editor ? JSON.stringify({ editorId: 'A', sourceGroupId: 'g1' }) : ''),
				types: [DND_MIME.editor],
				dropEffect: '',
				effectAllowed: ''
			}
			act(() => {
				const drop = new Event('drop', { bubbles: true, cancelable: true })
				Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer })
				content.dispatchEvent(drop)
			})
			expect(
				isEditorDragEvent({ dataTransfer: undefined } as unknown as DragEvent),
				'split-drop must clear the editor-drag payload'
			).toBe(false)
		} finally {
			clearEditorDragData()
		}
	})

	it('activates the owning group when a mousedown lands inside portalled tab content', () => {
		// Same portal side-effect class as the dragover test: React's
		// synthetic `onMouseDown` / `onFocusCapture` on the group's
		// placeholder never sees clicks deep inside the portalled tab
		// content (synthetic events bubble through the React tree, which
		// ends at `EditorWorkbench`). The group's activate-on-click
		// listener has to be a native DOM `mousedown` to be reached by
		// real DOM bubbling.
		effectLog.length = 0
		render(
			<StrictMode>
				<EditorWorkbench
					tree={{
						orientation: 'horizontal',
						groups: [
							{ id: 'g1', tabs: [tab('A')], activeTabId: 'A' },
							{ id: 'g2', tabs: [tab('B')], activeTabId: 'B' }
						]
					}}
					renderTabContent={renderTabContent}
					data-testid="ewb"
				/>
			</StrictMode>
		)
		const g1 = document.querySelector('[data-testid="ewb-group-g1"]')
		const g2 = document.querySelector('[data-testid="ewb-group-g2"]')
		expect(g1, 'group g1 container must render').not.toBeNull()
		expect(g2, 'group g2 container must render').not.toBeNull()

		// Click deep inside A's portalled content. The mousedown DOM
		// event must reach g1's placeholder listener and mark g1 focused.
		act(() => {
			screen.getByTestId('content-A').dispatchEvent(
				new MouseEvent('mousedown', { bubbles: true, cancelable: true })
			)
		})
		expect(
			g1?.getAttribute('data-has-focus'),
			'g1 must become focused when a mousedown lands inside its portalled tab content'
		).toBe('true')
		expect(g2?.getAttribute('data-has-focus')).toBe('false')

		// And switching focus the other way works too.
		act(() => {
			screen.getByTestId('content-B').dispatchEvent(
				new MouseEvent('mousedown', { bubbles: true, cancelable: true })
			)
		})
		expect(g2?.getAttribute('data-has-focus')).toBe('true')
		expect(g1?.getAttribute('data-has-focus')).toBe('false')
	})
})
