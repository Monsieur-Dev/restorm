import { describe, it, expect, beforeEach, vi } from 'vitest'

// Stub the ECUI singletons the store fires through, so this exercises the
// resolution logic in isolation (and avoids the logger touching `app`).
vi.mock('electron-core-ui/main', () => ({
  eventBusService: { emit: vi.fn(() => Promise.resolve()) },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createPubSub: () => ({ publish: vi.fn(), asyncIterator: vi.fn() }),
  serializeWithDecorators: (_c: unknown, o: unknown) => o
}))

import { resolveScenarioTarget } from './resolveScenario'
import { collectionStore } from '../services/CollectionStore'

function seed(): void {
  // Root / Mid / {Main, Logs}  +  Root / Other / Logs (a repeated leaf name).
  collectionStore.setCollections([
    {
      type: 'environment-folder',
      id: 'root',
      name: 'Root',
      tags: [],
      items: [
        {
          id: 'mid', name: 'Mid', configuration: {}, items: [
            { type: 'scenario', id: 's-main', name: 'Main', tags: [], params: [], nodes: [], edges: [], items: [] },
            { type: 'scenario', id: 's-logs', name: 'Logs', tags: [], params: [], nodes: [], edges: [], items: [] }
          ]
        },
        {
          id: 'other', name: 'Other', configuration: {}, items: [
            { type: 'scenario', id: 's-logs2', name: 'Logs', tags: [], params: [], nodes: [], edges: [], items: [] }
          ]
        }
      ],
      environments: []
    }
  ] as unknown as Parameters<typeof collectionStore.setCollections>[0])
}

describe('resolveScenarioTarget', () => {
  beforeEach(() => { seed() })

  it('resolves an exact index path', () => {
    expect(resolveScenarioTarget('Root/Mid/Main', 'name')).toEqual({ id: 's-main' })
  })

  it('resolves a unique bare leaf name', () => {
    expect(resolveScenarioTarget('Main', 'name')).toEqual({ id: 's-main' })
  })

  it('resolves a unique full path even when the leaf name repeats elsewhere', () => {
    expect(resolveScenarioTarget('Root/Mid/Logs', 'name')).toEqual({ id: 's-logs' })
  })

  it('reports ambiguity for a repeated bare leaf name', () => {
    const result = resolveScenarioTarget('Logs', 'name')
    expect('error' in result && result.error).toMatch(/ambiguous/)
  })

  it('reports not-found with the available list', () => {
    const result = resolveScenarioTarget('Nope', 'name')
    expect('error' in result && result.error).toMatch(/no scenario named 'Nope'/)
    expect('error' in result && result.error).toMatch(/Root\/Mid\/Main/)
  })

  it('resolves by id', () => {
    expect(resolveScenarioTarget('s-logs', 'id')).toEqual({ id: 's-logs' })
  })

  it('errors on an unknown id', () => {
    const result = resolveScenarioTarget('missing', 'id')
    expect('error' in result && result.error).toMatch(/no scenario with id 'missing'/)
  })
})
