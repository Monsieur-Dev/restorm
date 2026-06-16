// @vitest-environment jsdom
/**
 * Persistence regression: switching `workbenchId` on a LIVE mount.
 *
 * `workbenchId` keys the persisted tree. A host that reuses one workbench
 * across documents (e.g. opening a different file over the current one) flips
 * the id without remounting. The bug this pins: left un-handled, the workbench
 * keeps the PREVIOUS id's tabs on screen AND its autosave writes that stale
 * tree back under the NEW id — corrupting the incoming document's saved
 * workbench. The fix re-arms the restore on an id swap, empties the tree first,
 * and suspends the autosave writer until the new restore completes.
 */
import React, { useState } from 'react'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import type { WorkbenchTree, EditorTab } from './types'

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
import { saveWorkbenchState, loadWorkbenchState } from './persistence'

beforeAll(() => {
	if (!('ResizeObserver' in globalThis)) {
		;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
			observe(): void { /* no-op */ }
			unobserve(): void { /* no-op */ }
			disconnect(): void { /* no-op */ }
		}
	}
})

beforeEach(() => {
	vi.clearAllMocks()
})

const tab = (id: string): EditorTab => ({ id, title: id, titleString: id })
const renderTabContent = (t: EditorTab): React.ReactNode => <div data-testid={`content-${t.id}`}>{t.id}</div>
const oneTabTree = (id: string): WorkbenchTree => ({
	orientation: 'vertical',
	groups: [{ id: 'g1', tabs: [tab(id)], activeTabId: id }]
})

/** Controlled host that owns the tree (mirrors how restorm drives the
 * workbench) and lets the test flip `workbenchId` between renders. */
const Harness: React.FC<{ workbenchId: string }> = ({ workbenchId }) => {
	const [tree, setTree] = useState<WorkbenchTree>(oneTabTree('A'))
	return (
		<EditorWorkbench
			tree={tree}
			onChange={setTree}
			autosave
			workbenchId={workbenchId}
			onRebuildTab={() => null}
			renderTabContent={renderTabContent}
		/>
	)
}

describe('EditorWorkbench — workbenchId swap on a live mount', () => {
	it('drops the previous id\'s tabs, re-restores the new id, and never writes the old tree under the new id', async () => {
		const { rerender } = render(<Harness workbenchId="file-A" />)
		// Tab from file-A is mounted.
		expect(screen.getByTestId('content-A').isConnected).toBe(true)

		// Swap to a different document (file-B has nothing persisted → mock
		// loadWorkbenchState resolves null).
		await act(async () => {
			rerender(<Harness workbenchId="file-B" />)
			// let the async restore settle
			await Promise.resolve()
		})

		// 1. The previous document's tab is gone (not lingering).
		expect(screen.queryByTestId('content-A'), 'file-A tab must close on the swap').toBeNull()

		// 2. The new id's saved state was queried (restore was re-armed).
		expect(loadWorkbenchState).toHaveBeenCalledWith('file-B')

		// 3. No pollution: the stale tree (still holding tab A) is NEVER
		//    written under the new id.
		const pollutingSave = (saveWorkbenchState as unknown as { mock: { calls: unknown[][] } }).mock.calls
			.find(([id]) => id === 'file-B')
		expect(pollutingSave, 'old tree must not be autosaved under the new id').toBeUndefined()
	})

	it('does not clear or re-arm on the initial undefined→id transition', async () => {
		// projectUuid resolves async in the host, so the first real id arrives
		// after an undefined render. That must NOT be treated as a doc swap.
		const Initial: React.FC<{ workbenchId: string | undefined }> = ({ workbenchId }) => {
			const [tree, setTree] = useState<WorkbenchTree>(oneTabTree('A'))
			return (
				<EditorWorkbench
					tree={tree}
					onChange={setTree}
					autosave
					{...(workbenchId !== undefined ? { workbenchId } : {})}
					onRebuildTab={() => null}
					renderTabContent={renderTabContent}
				/>
			)
		}
		const { rerender } = render(<Initial workbenchId={undefined} />)
		await act(async () => {
			rerender(<Initial workbenchId="file-A" />)
			await Promise.resolve()
		})
		// The tab the host opened must survive the id first becoming defined.
		expect(screen.getByTestId('content-A').isConnected).toBe(true)
	})
})
