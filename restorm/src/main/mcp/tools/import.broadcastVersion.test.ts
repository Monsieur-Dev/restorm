/**
 * Wiring: `broadcastTreeReplace` bumps the model version on a real mutation and
 * ships it as `mcpVersion` in the IPC payload — the stamp the renderer echoes
 * back so the store can refuse a stale autosave mirror (see
 * `services/collectionStoreWriteRace.test.ts` for the guard itself).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const sent: { channel: string; payload: unknown }[] = []

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [
      { isDestroyed: () => false, webContents: { send: (channel: string, payload: unknown) => { sent.push({ channel, payload }) } } }
    ]
  }
}))

let version = 0
vi.mock('../../services/CollectionStore', () => ({
  collectionStore: {
    getCollections: () => [{ id: 'root', name: 'Root', items: [], environments: [] }],
    getModelVersion: () => version,
    bumpModelVersion: () => { version += 1; return version }
  },
  pubsub: { publish: vi.fn() },
  PUBSUB_TOPICS: {}
}))

import { broadcastTreeReplace } from './import'

describe('broadcastTreeReplace version stamp', () => {
  beforeEach(() => { sent.length = 0; version = 0 })

  it('bumps the version and ships it as mcpVersion on a mutation', () => {
    broadcastTreeReplace()
    const msg = sent.find((s) => s.channel === 'mcp:tree-replace')
    expect(msg).toBeDefined()
    const payload = msg?.payload as { items: unknown[]; mcpVersion: number }
    expect(payload.mcpVersion).toBe(1)
    expect(Array.isArray(payload.items)).toBe(true)

    sent.length = 0
    broadcastTreeReplace()
    const second = sent.find((s) => s.channel === 'mcp:tree-replace')?.payload as { mcpVersion: number }
    expect(second.mcpVersion).toBe(2)
  })

  it('does NOT bump when re-broadcasting to heal a refused mirror', () => {
    broadcastTreeReplace() // version → 1
    sent.length = 0
    broadcastTreeReplace({ bumpVersion: false })
    const payload = sent.find((s) => s.channel === 'mcp:tree-replace')?.payload as { mcpVersion: number }
    // Same version — a heal re-sync must not inflate the counter (would loop).
    expect(payload.mcpVersion).toBe(1)
  })
})
