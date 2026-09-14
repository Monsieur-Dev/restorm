import { describe, it, expect } from 'vitest'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { prepareForSerialization } from '../../src/shared/utils/serialization'
import { processAfterDeserialization } from '../../src/renderer/src/utils/serialization'
import { requiredFileFormatVersion, BASE_FILE_FORMAT_VERSION, RECORDING_FILE_FORMAT_VERSION } from '../../src/shared/config/fileFormatVersion'
import { idPathSegment } from '../../src/shared/utils/stableId'
import { RECORDING_PROTOCOLS, isRecordingSession, isRequest, isScenario, isApiDesign, isAnyFolder } from '../../src/shared/types/collections'
import type { RecordingSession, FolderItem } from '../../src/shared/types/collections'
import { RecordingSession as RecordingSessionModel } from '../../src/shared/models/RecordingSession'
import { kindOf } from '../../src/shared/git/gitCommitDiff'

/**
 * A recording session rides the same persistence pipeline as every other
 * tree item. WITHOUT electron, these tests prove: the persisted shape is
 * exactly url + protocols + white/black lists + deduced routes (and never
 * captures); the deduced routes are ordinary items the walks see; the
 * round-trip is lossless and deterministic; the lazy 1.2 bump follows the
 * content; and the type guards classify a session apart from every other
 * kind.
 */

function dumpYaml(content: unknown): string {
  return stringifyYaml(content, { lineWidth: 0 })
}

/** The renderer's save pipeline in memory (see apiDesignSerialization.test.ts). */
function saveDocument(collections: unknown): string {
  const rehydrated = processAfterDeserialization(collections)
  const version = requiredFileFormatVersion(rehydrated)
  const plain = JSON.parse(JSON.stringify({ fileFormatVersion: version, collections: rehydrated })) as Record<string, unknown>
  return dumpYaml(prepareForSerialization(plain))
}

function loadDocument(rawYaml: string): { fileFormatVersion?: number; collections: unknown[] } {
  const parsed = parseYaml(rawYaml) as { fileFormatVersion?: number; collections?: unknown } | null
  return {
    ...(typeof parsed?.fileFormatVersion === 'number' && { fileFormatVersion: parsed.fileFormatVersion }),
    collections: Array.isArray(parsed?.collections) ? parsed.collections : []
  }
}

function reverseKeys<T>(data: T): T {
  if (data === null || typeof data !== 'object') return data
  if (Array.isArray(data)) return data.map((v: unknown) => reverseKeys(v)) as T
  const record = data as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(record).reverse()) out[key] = reverseKeys(record[key])
  return out as T
}

/** A session that already deduced two routes (a nested folder + requests). */
function buildReferenceSession(): RecordingSession {
  return {
    type: 'recording',
    id: 'rec-petstore',
    name: 'Petstore session',
    notes: 'Recorded from the swagger UI',
    url: 'http://localhost:8080/',
    protocols: ['http', 'websocket'],
    whitelist: ['^http://localhost:8080/api/.*'],
    blacklist: ['\\.(png|css|js)$'],
    items: [
      {
        id: 'rec-folder-api',
        name: 'api',
        tags: [],
        configuration: {},
        items: [
          {
            type: 'http',
            id: 'rec-req-swagger',
            name: 'GET swagger.json',
            method: 'GET',
            url: 'http://localhost:8080/api/swagger.json',
            headers: [{ key: 'Accept', value: { type: 'string', value: 'application/json' }, enabled: true }],
            params: []
          } as unknown as FolderItem
        ]
      }
    ]
  }
}

function collectionRoot(): Record<string, unknown> {
  return { folderType: 'environment', id: 'env-1', name: 'API', tags: [], configuration: {}, environments: [], items: [] }
}

describe('recording session — persistence round-trip', () => {
  it('the reference session survives save→load identically (every field)', () => {
    const original = buildReferenceSession()
    const saved = saveDocument([original])
    const loaded = loadDocument(saved).collections[0] as RecordingSession
    expect(loaded).toEqual(JSON.parse(JSON.stringify(original)))
  })

  it('a project with a session persists at the recording format version', () => {
    const saved = saveDocument([collectionRoot(), buildReferenceSession()])
    expect(loadDocument(saved).fileFormatVersion).toBe(RECORDING_FILE_FORMAT_VERSION)
    expect(saved.startsWith(`fileFormatVersion: ${String(RECORDING_FILE_FORMAT_VERSION)}\n`)).toBe(true)
  })

  it('a project without a session persists at the base version', () => {
    expect(loadDocument(saveDocument([collectionRoot()])).fileFormatVersion).toBe(BASE_FILE_FORMAT_VERSION)
  })

  it('open→save is a byte-stable fixed point', () => {
    const s1 = saveDocument([collectionRoot(), buildReferenceSession()])
    const s2 = saveDocument(loadDocument(s1).collections)
    expect(s2).toBe(s1)
  })

  it('key order on disk does not change what a save writes', () => {
    const saved = saveDocument([collectionRoot(), buildReferenceSession()])
    expect(saveDocument(reverseKeys(loadDocument(saved).collections))).toBe(saved)
  })

  it('the deduced routes are walked like any request (a bare header value is canonicalized)', () => {
    const session = buildReferenceSession()
    const route = (session.items?.[0] as { items: { headers: { value: unknown }[] }[] }).items[0]
    if (route === undefined) throw new Error('fixture has a route')
    const header0 = route.headers[0]
    if (header0 === undefined) throw new Error('fixture has a header')
    header0.value = 'text/plain'
    const loaded = loadDocument(saveDocument([session])).collections[0] as RecordingSession
    const header = (loaded.items?.[0] as { items: { headers: { value: unknown }[] }[] }).items[0]?.headers[0]
    expect(header?.value).toEqual({ type: 'string', value: 'text/plain' })
  })

  it('a session nested in a folder is found by the version walk', () => {
    const folder = { ...collectionRoot(), items: [buildReferenceSession()] }
    expect(loadDocument(saveDocument([folder])).fileFormatVersion).toBe(RECORDING_FILE_FORMAT_VERSION)
  })
})

describe('recording session — the model class', () => {
  it('persists only url, protocols, lists and routes (captures never reach the plain object)', () => {
    const session = RecordingSessionModel.fromPlain({ ...buildReferenceSession(), captures: [{ id: 'c1' }] } as Parameters<typeof RecordingSessionModel.fromPlain>[0])
    const plain = session.toPlainObject()
    expect(Object.keys(plain).sort()).toEqual(['blacklist', 'id', 'items', 'name', 'notes', 'protocols', 'type', 'url', 'whitelist'])
    expect(plain['type']).toBe('recording')
    expect(plain['items']).toHaveLength(1)
  })

  it('a session that never deduced anything serializes without an items key', () => {
    const { items: _routes, ...bare } = buildReferenceSession()
    const plain = RecordingSessionModel.fromPlain(bare).toPlainObject()
    expect('items' in plain).toBe(false)
  })

  it('defaults a missing or empty protocol list to every protocol, and drops unknown keys', () => {
    expect(RecordingSessionModel.fromPlain({ name: 's' }).protocols).toEqual([...RECORDING_PROTOCOLS])
    expect(RecordingSessionModel.fromPlain({ name: 's', protocols: [] }).protocols).toEqual([...RECORDING_PROTOCOLS])
    expect(RecordingSessionModel.fromPlain({ name: 's', protocols: ['http', 'carrier-pigeon'] }).protocols).toEqual(['http'])
  })

  it('tolerates a missing url and malformed lists (a hand-edited or older file)', () => {
    const session = RecordingSessionModel.fromPlain({ name: 's', whitelist: 'not-a-list', blacklist: [1, 'ok'] } as unknown as Parameters<typeof RecordingSessionModel.fromPlain>[0])
    expect(session.url).toBe('')
    expect(session.whitelist).toEqual([])
    expect(session.blacklist).toEqual(['ok'])
  })
})

describe('recording session — type guards and kinds', () => {
  it('is a recording session and nothing else, with or without deduced routes', () => {
    const withRoutes = buildReferenceSession()
    const { items: _routes, ...bare } = withRoutes
    for (const session of [withRoutes, bare as RecordingSession]) {
      expect(isRecordingSession(session)).toBe(true)
      expect(isRequest(session)).toBe(false)
      expect(isScenario(session)).toBe(false)
      expect(isApiDesign(session)).toBe(false)
      expect(isAnyFolder(session)).toBe(false)
    }
  })

  it('classifies a session as its own git entity kind', () => {
    expect(kindOf(buildReferenceSession())).toBe('recording')
  })

  it('spells the session as a container segment of the stable-id grammar', () => {
    expect(idPathSegment(buildReferenceSession() as unknown as Record<string, unknown>)).toBe('recording:Petstore session')
  })

  it('backfills ids on deduced routes that arrive without one, and keeps persisted ids verbatim', () => {
    const session = buildReferenceSession()
    const route = (session.items?.[0] as { items: Record<string, unknown>[] }).items[0]
    if (route === undefined) throw new Error('fixture has a route')
    delete route['id']
    const loaded = processAfterDeserialization([session])
    expect(loaded[0]?.id).toBe('rec-petstore')
    const folder = loaded[0]?.items?.[0] as { id: string; items: { id?: string }[] }
    expect(folder.id).toBe('rec-folder-api')
    expect(typeof folder.items[0]?.id).toBe('string')
    expect(folder.items[0]?.id).not.toBe('')
  })
})
