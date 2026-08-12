import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { CliRunOptions } from './args'

// Stub the ECUI singletons the store fires through (see resolveScenario.test).
vi.mock('electron-core-ui/main', () => ({
  eventBusService: { emit: vi.fn(() => Promise.resolve()) },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createPubSub: () => ({ publish: vi.fn(), asyncIterator: vi.fn() }),
  serializeWithDecorators: (_c: unknown, o: unknown) => o
}))

const startMock = vi.fn<(...args: unknown[]) => unknown>()
vi.mock('../scenarioEngine/engine', () => ({
  scenarioEngine: { start: (...args: unknown[]): unknown => startMock(...args) }
}))

import { runScenarioHeadless } from './headlessRunner'
import { collectionStore } from '../services/CollectionStore'

/** Seed a single scenario whose `object` box carries an edge to a property
 * (`prop-gone`) that no longer exists on it — the orphan the editor's load-time
 * sanitizer would drop, but which the headless path never saw before. */
function seedOrphan(): void {
  collectionStore.setCollections([
    {
      type: 'environment-folder', id: 'root', name: 'Root', tags: [], environments: [],
      items: [
        {
          type: 'scenario', id: 'scn-orphan', name: 'Orphan', tags: [], params: [], items: [],
          nodes: [
            { id: 'req', kind: 'httpRequest', config: {}, inputs: [], outputs: [], position: { x: 0, y: 0 } },
            { id: 'obj', kind: 'object', config: { properties: [{ id: 'prop-live', name: 'live' }] }, inputs: [], outputs: [], position: { x: 0, y: 0 } }
          ],
          edges: [{ id: 'e1', from: { nodeId: 'req', portId: 'response' }, to: { nodeId: 'obj', portId: 'prop-gone' } }]
        }
      ]
    }
  ] as unknown as Parameters<typeof collectionStore.setCollections>[0])
}

/** Same shape, but the edge targets the LIVE property — a clean run. */
function seedClean(): void {
  collectionStore.setCollections([
    {
      type: 'environment-folder', id: 'root', name: 'Root', tags: [], environments: [],
      items: [
        {
          type: 'scenario', id: 'scn-clean', name: 'Clean', tags: [], params: [], items: [],
          nodes: [
            { id: 'req', kind: 'httpRequest', config: {}, inputs: [], outputs: [], position: { x: 0, y: 0 } },
            { id: 'obj', kind: 'object', config: { properties: [{ id: 'prop-live', name: 'live' }] }, inputs: [], outputs: [], position: { x: 0, y: 0 } }
          ],
          edges: [{ id: 'e1', from: { nodeId: 'req', portId: 'response' }, to: { nodeId: 'obj', portId: 'prop-live' } }]
        }
      ]
    }
  ] as unknown as Parameters<typeof collectionStore.setCollections>[0])
}

const opts = (target: string): CliRunOptions => ({ target, by: 'id', verbose: false, headless: true, params: {} } as unknown as CliRunOptions)

describe('runScenarioHeadless — orphan-edge gate', () => {
  beforeEach(() => { startMock.mockReset() })

  it('refuses (exit 2) a scenario with an orphan edge WITHOUT starting the engine', async () => {
    seedOrphan()
    const code = await runScenarioHeadless(opts('scn-orphan'))
    expect(code).toBe(2)
    expect(startMock).not.toHaveBeenCalled()
  })

  it('runs a clean scenario (engine started) — the gate is not over-broad', async () => {
    seedClean()
    startMock.mockReturnValue({ scheduler: { status: () => ({ state: 'completed' }) }, done: Promise.resolve() })
    const code = await runScenarioHeadless(opts('scn-clean'))
    expect(code).toBe(0)
    expect(startMock).toHaveBeenCalledTimes(1)
  })
})
