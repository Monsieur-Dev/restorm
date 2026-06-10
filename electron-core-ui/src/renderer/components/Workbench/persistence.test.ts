import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PersistedWorkbenchState } from './persistence'

// `loadWorkbenchTabIds` reads through `loadFromStorage`; stub the storage layer
// so the test drives the persisted shape directly.
const loadFromStorage = vi.fn<(key: string) => Promise<unknown>>()
vi.mock('../../hooks/useStorage', () => ({
	saveToStorage: vi.fn(() => Promise.resolve(true)),
	loadFromStorage: (key: string) => loadFromStorage(key)
}))

import { loadWorkbenchTabIds } from './persistence'

describe('loadWorkbenchTabIds', () => {
	beforeEach(() => {
		loadFromStorage.mockReset()
	})

	it('returns an empty array when nothing is persisted', async () => {
		loadFromStorage.mockResolvedValueOnce(undefined)
		expect(await loadWorkbenchTabIds('wb')).toEqual([])
	})

	it('collects tab ids from a single group', async () => {
		const state: PersistedWorkbenchState = {
			orientation: 'vertical',
			groups: [{ type: 'tabs', id: 'g1', tabIds: ['a', 'b'], activeTabId: 'a' }]
		}
		loadFromStorage.mockResolvedValueOnce(state)
		expect(await loadWorkbenchTabIds('wb')).toEqual(['a', 'b'])
	})

	it('walks split-pane containers and returns every tab id in order', async () => {
		const state: PersistedWorkbenchState = {
			orientation: 'horizontal',
			groups: [
				{ type: 'tabs', id: 'left', tabIds: ['a', 'b'], activeTabId: 'a' },
				{
					type: 'container',
					id: 'c1',
					orientation: 'vertical',
					children: [
						{ type: 'tabs', id: 'r1', tabIds: ['c'], activeTabId: 'c' },
						{ type: 'tabs', id: 'r2', tabIds: ['d', 'e'], activeTabId: 'd' }
					]
				}
			]
		}
		loadFromStorage.mockResolvedValueOnce(state)
		expect(await loadWorkbenchTabIds('wb')).toEqual(['a', 'b', 'c', 'd', 'e'])
	})

	it('returns an empty array for a persisted state with no tabs', async () => {
		const state: PersistedWorkbenchState = { orientation: 'vertical', groups: [] }
		loadFromStorage.mockResolvedValueOnce(state)
		expect(await loadWorkbenchTabIds('wb')).toEqual([])
	})
})
