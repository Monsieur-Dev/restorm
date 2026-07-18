/**
 * Regression: a burst of MCP write mutations racing the renderer's autosave
 * mirror must not lose main-side mutations.
 *
 * Every MCP write tool mutates the main `collectionStore` then broadcasts a
 * tree-replace — which bumps the model version (see
 * `mcp/tools/import.ts#broadcastTreeReplace`) — plus an autosave trigger. The
 * renderer serialises ITS model and mirrors it back through `collections:sync`.
 * If that mirror lands while the renderer is still one (or more) mutations
 * behind, a naïve `setCollections('user')` overwrites the freshly-mutated tree
 * with the stale one, silently dropping the just-created scenario nodes (the
 * real symptom: a scenario built over MCP fell back to 0-7 nodes after green
 * runs).
 *
 * This drives the REAL `collectionStore`. The MCP write burst is modelled as a
 * live mutation + `bumpModelVersion()` per write — exactly the version
 * side-effect `broadcastTreeReplace` produces (that wiring is covered
 * separately in `mcp/tools/import.broadcastVersion.test.ts`).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('electron-core-ui/main', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  eventBusService: { emit: vi.fn(), emitSync: vi.fn(), subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) },
  createPubSub: () => ({ publish: vi.fn(), subscribe: vi.fn() }),
  serializeWithDecorators: (_ctor: unknown, plain: unknown) => plain
}))

import { collectionStore } from './CollectionStore'
import type { Scenario } from '../../shared/models/Scenario'

function snapshot(): unknown[] {
  return JSON.parse(JSON.stringify(collectionStore.getCollections())) as unknown[]
}

function seedScenario(): void {
  const scenarioPlain = {
    id: 's1', type: 'scenario', name: 'Redis', tags: [], params: [], nodes: [], edges: [], items: []
  }
  const envFolder = { id: 'root', name: 'Root', items: [scenarioPlain], environments: [] }
  collectionStore.setCollections([envFolder as never], 'file-load')
}

function currentScenario(): Scenario {
  const s = collectionStore.findById('s1') as unknown as Scenario | null
  if (!s) throw new Error('scenario s1 not found')
  return s
}

/** Model one MCP write: mutate the live tree, then bump the version exactly as
 * `broadcastTreeReplace` does after every write tool. */
function mcpWriteAddNode(): void {
  currentScenario().nodes.push({
    id: `n${String(currentScenario().nodes.length)}`,
    kind: 'log', config: {}, inputs: [], outputs: [], position: { x: 0, y: 0 }
  } as never)
  collectionStore.bumpModelVersion()
}

describe('collectionStore write-race guard', () => {
  beforeEach(() => { seedScenario() })

  it('keeps every burst-created node when a STALE autosave mirror lands', () => {
    const staleTree = snapshot()
    const staleVersion = collectionStore.getModelVersion()
    expect(currentScenario().nodes).toHaveLength(0)

    for (let i = 0; i < 8; i += 1) mcpWriteAddNode()
    expect(currentScenario().nodes).toHaveLength(8)
    expect(collectionStore.getModelVersion()).toBeGreaterThan(staleVersion)

    // Renderer autosave fires with the pre-burst tree + stamp → refused.
    const applied = collectionStore.setCollections(staleTree as never, 'user', staleVersion)
    expect(applied).toBe(false)
    // The mutations survive — the whole point of the ticket.
    expect(currentScenario().nodes).toHaveLength(8)
  })

  it('refuses a mirror that is behind by even one version', () => {
    const v0 = collectionStore.getModelVersion()
    mcpWriteAddNode()
    expect(collectionStore.setCollections(snapshot() as never, 'user', v0)).toBe(false)
    expect(currentScenario().nodes).toHaveLength(1)
  })

  it('accepts an up-to-date mirror (renderer caught up to the current version)', () => {
    for (let i = 0; i < 3; i += 1) mcpWriteAddNode()
    const applied = collectionStore.setCollections(snapshot() as never, 'user', collectionStore.getModelVersion())
    expect(applied).toBe(true)
    expect(currentScenario().nodes).toHaveLength(3)
  })

  it('a mirror with no version stamp is trusted (legacy / main-side callers)', () => {
    mcpWriteAddNode()
    expect(collectionStore.setCollections(snapshot() as never, 'user')).toBe(true)
  })

  it('file-load is never gated by the version', () => {
    mcpWriteAddNode()
    // A fresh project load must replace the tree regardless of the counter.
    const applied = collectionStore.setCollections(
      [{ id: 'other', name: 'Other', items: [], environments: [] } as never],
      'file-load'
    )
    expect(applied).toBe(true)
    expect(collectionStore.findById('s1')).toBeNull()
  })
})
