import { describe, it, expect, beforeEach, vi } from 'vitest'

// In-memory user-settings store + the other electron-core-ui/main exports the
// CollectionStore + quickConfig module touch on import.
const fakeStore = new Map<string, unknown>()
vi.mock('electron-core-ui/main', () => ({
  eventBusService: { emit: vi.fn(() => Promise.resolve()) },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  createPubSub: () => ({ publish: vi.fn(), asyncIterator: vi.fn() }),
  serializeWithDecorators: (_c: unknown, o: unknown) => o,
  getStorageService: () => ({
    get: (k: string) => fakeStore.get(k),
    set: (k: string, v: unknown) => { fakeStore.set(k, v) },
    delete: (k: string) => { fakeStore.delete(k) }
  })
}))

// The active project uuid comes from the favorites bridge — stub it.
let activeUuid: string | null = 'proj-1'
vi.mock('./favoritesBridge', () => ({
  getFavoritesSnapshot: () => ({ projectUuid: activeUuid, favorites: [] })
}))

import { collectionStore } from '../services/CollectionStore'
import { REQUEST_TYPES } from '../../shared/models/types'
import {
  PROTOCOL_CONFIG_FIELDS, validateConfigFields, describeConfigSchema,
  listConfigs, addConfig, updateConfig, deleteConfig
} from './quickConfig'

/** Identity / non-snapshot keys — EXACTLY the renderer snapshot's exclusions
 * (note: `documentation` is NOT excluded, so it IS a config field). */
const EXCLUDED = new Set([
  'id', 'name', 'notes', 'tags', 'icon', 'importOrigin', 'deprecated', 'removed',
  'toPlainObject', 'authenticationRequestId', 'type', 'quickConfigs'
])

function seedRoot(): void {
  collectionStore.setCollections([
    { type: 'environment-folder', id: 'root', name: 'Root', tags: [], items: [], environments: [] }
  ] as unknown as Parameters<typeof collectionStore.setCollections>[0])
}

describe('quickConfig — per-protocol field schema', () => {
  beforeEach(() => { fakeStore.clear(); activeUuid = 'proj-1'; seedRoot() })

  it('every protocol has an accepted-field set', () => {
    for (const p of REQUEST_TYPES) expect(PROTOCOL_CONFIG_FIELDS[p].length).toBeGreaterThan(0)
  })

  // Drift guard: a freshly-created request's serialized config fields must all be
  // accepted by its protocol's set — so the model gaining a field that the schema
  // forgot fails here.
  it('accepts every config field a freshly-created request actually serializes', () => {
    const gaps: string[] = []
    for (const proto of REQUEST_TYPES) {
      const req = collectionStore.createRequest('root', { type: proto, name: `r-${proto}` })
      const plain = (req as unknown as { toPlainObject: () => Record<string, unknown> }).toPlainObject()
      const snapshotKeys = Object.keys(plain).filter((k) => !EXCLUDED.has(k))
      const allowed = new Set(PROTOCOL_CONFIG_FIELDS[proto])
      const missing = snapshotKeys.filter((k) => !allowed.has(k))
      if (missing.length > 0) gaps.push(`${proto}: ${missing.join(', ')}`)
    }
    expect(gaps, `schema is missing fields:\n${gaps.join('\n')}`).toEqual([])
  })

  it('validateConfigFields rejects fields foreign to the protocol', () => {
    expect(validateConfigFields('http', { url: 'x', color: '#fff' })).toMatch(/color/)
    expect(validateConfigFields('graphql', { query: 'q' })).toBeNull()
    expect(validateConfigFields('http', { query: 'q' })).toMatch(/not valid for a http/)
    expect(validateConfigFields('http', 'nope')).toMatch(/must be an object/)
    // `documentation` IS a config field (renderer keeps it) — a saved snapshot
    // round-trips back through add/update.
    expect(validateConfigFields('http', { url: 'x', documentation: 'd' })).toBeNull()
  })

  it('a fresh request advertises url, and no protocol set carries duplicates', () => {
    for (const proto of REQUEST_TYPES) {
      const set = PROTOCOL_CONFIG_FIELDS[proto]
      expect(set, `${proto} should accept url`).toContain('url')
      expect(new Set(set).size, `${proto} has duplicate fields`).toBe(set.length)
    }
  })

  it('describeConfigSchema returns one or all protocols', () => {
    expect(Object.keys(describeConfigSchema('grpc'))).toEqual(['grpc'])
    expect(Object.keys(describeConfigSchema()).sort()).toEqual([...REQUEST_TYPES].sort())
  })
})

describe('quickConfig — CRUD across both backends', () => {
  beforeEach(() => { fakeStore.clear(); activeUuid = 'proj-1'; seedRoot() })

  it('adds a project config to the request and lists it back with its target', () => {
    const req = collectionStore.createRequest('root', { type: 'http', id: 'req-1', name: 'R' })
    const res = addConfig(req, 'prod', { url: 'https://prod', method: 'GET' })
    expect(res.ok).toBe(true)
    const listed = listConfigs(req)
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ name: 'prod', storageTarget: 'project' })
  })

  it('lists settings-target configs (read-only) alongside project configs', () => {
    // Seed a settings config directly in the store (the renderer owns writes).
    fakeStore.set('request_quick_configs:proj-1', {
      'req-1': [{ id: 'sc1', name: 'mine', requestId: 'req-1', storageTarget: 'settings', fields: {}, createdAt: 't', updatedAt: 't' }]
    })
    const req = collectionStore.createRequest('root', { type: 'http', id: 'req-1', name: 'R' })
    addConfig(req, 'prod', { url: 'https://p' })
    const listed = listConfigs(req)
    expect(listed.map((c) => `${c.storageTarget}:${c.name}`)).toEqual(['settings:mine', 'project:prod'])
  })

  it('rejects an add whose fields are foreign to the protocol', () => {
    const req = collectionStore.createRequest('root', { type: 'http', id: 'req-1', name: 'R' })
    const res = addConfig(req, 'bad', { variables: '{}' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/variables/)
  })

  it('round-trips list -> update: a listed config (incl. documentation) updates without rejection', () => {
    const req = collectionStore.createRequest('root', { type: 'http', id: 'req-1', name: 'R' })
    const added = addConfig(req, 'c', { url: 'https://a', documentation: 'doc' })
    if (!added.ok || !added.config) throw new Error('add failed')
    const fromList = listConfigs(req).find((c) => c.id === added.config?.id)
    expect(fromList?.fields).toMatchObject({ url: 'https://a', documentation: 'doc' })
    // Feeding the listed fields straight back must be accepted (documentation included).
    const upd = updateConfig(req, added.config.id, { fields: fromList?.fields ?? {} })
    expect(upd.ok).toBe(true)
  })

  it('updates then deletes a project config by id', () => {
    const req = collectionStore.createRequest('root', { type: 'http', id: 'req-1', name: 'R' })
    const added = addConfig(req, 'c', { url: 'https://a' })
    if (!added.ok || !added.config) throw new Error('add failed')
    const id = added.config.id

    const upd = updateConfig(req, id, { fields: { url: 'https://b' }, name: 'renamed' })
    expect(upd.ok).toBe(true)
    if (upd.ok) expect(upd.config).toMatchObject({ name: 'renamed', fields: { url: 'https://b' } })

    expect(deleteConfig(req, id).ok).toBe(true)
    expect(listConfigs(req)).toHaveLength(0)
  })

  it('update/delete of a settings-target id is refused (settings are app-managed)', () => {
    fakeStore.set('request_quick_configs:proj-1', {
      'req-1': [{ id: 'sc1', name: 'mine', requestId: 'req-1', storageTarget: 'settings', fields: {}, createdAt: 't', updatedAt: 't' }]
    })
    const req = collectionStore.createRequest('root', { type: 'http', id: 'req-1', name: 'R' })
    const del = deleteConfig(req, 'sc1')
    expect(del.ok).toBe(false)
    if (!del.ok) expect(del.error).toMatch(/user-settings/)
  })
})
