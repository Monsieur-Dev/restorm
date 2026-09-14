import { describe, it, expect } from 'vitest'
import { RecordingCaptureStore, summaryOf } from '../../../src/main/services/recording/RecordingCaptureStore'
import type { RecordedCallDetail, RecordingFilterConfig } from '../../../src/shared/types/recordingCapture'

const ALL: RecordingFilterConfig = { protocols: ['http', 'websocket', 'graphql', 'grpc-web'], whitelist: [], blacklist: [] }

let n = 0
function call(url: string, extra: Partial<RecordedCallDetail> = {}): RecordedCallDetail {
  n += 1
  return {
    id: `c${n}`,
    sessionId: 's1',
    runId: '',
    protocol: 'http',
    timestamp: n,
    method: 'GET',
    url,
    resourceType: 'fetch',
    status: 200,
    request: { headers: [{ key: 'Accept', value: '*/*' }], query: [], body: null },
    response: { headers: [], body: { encoding: 'utf8', data: '{}', mimeType: 'application/json', size: 2 } },
    ...extra
  }
}

function recordingStore(config: RecordingFilterConfig = ALL): RecordingCaptureStore {
  const store = new RecordingCaptureStore()
  store.startRun('s1', 'http://localhost:8080/', 'tab-1', config)
  return store
}

describe('recording capture store — the gate', () => {
  it('refuses a call for a session that is not recording', () => {
    const store = new RecordingCaptureStore()
    expect(store.offer(call('http://a/x'))).toBe(false)
    expect(store.status('s1')).toEqual({ sessionId: 's1', state: 'idle', runId: null, tabId: null, captureCount: 0 })
  })

  it('stores a call stamped with the live run while recording', () => {
    const store = recordingStore()
    const run = store.runs('s1')[0]
    expect(store.offer(call('http://a/x'))).toBe(true)
    const [row] = store.list('s1')
    expect(row?.runId).toBe(run?.id)
    expect(store.status('s1')).toMatchObject({ state: 'recording', runId: run?.id, tabId: 'tab-1', captureCount: 1 })
  })

  it('receives but does not store while paused, then resumes', () => {
    const store = recordingStore()
    store.setPaused('s1', true)
    expect(store.status('s1').state).toBe('paused')
    expect(store.offer(call('http://a/paused'))).toBe(false)
    expect(store.wouldAccept('s1', 'http', 'http://a/paused')).toBe(false)
    store.setPaused('s1', false)
    expect(store.offer(call('http://a/resumed'))).toBe(true)
    expect(store.list('s1').map((c) => c.url)).toEqual(['http://a/resumed'])
  })

  it('drops the protocols the session does not listen to', () => {
    const store = recordingStore({ ...ALL, protocols: ['http'] })
    expect(store.offer(call('http://a/graphql', { protocol: 'graphql' }))).toBe(false)
    expect(store.offer(call('http://a/rest'))).toBe(true)
  })

  it('applies the white list (OR) and the black list (last word) live', () => {
    const store = recordingStore({ ...ALL, whitelist: ['/api/'], blacklist: ['\\.png$'] })
    expect(store.offer(call('http://a/api/users'))).toBe(true)
    expect(store.offer(call('http://a/index.html'))).toBe(false)
    expect(store.offer(call('http://a/api/logo.png'))).toBe(false)
    store.setFilters('s1', { ...ALL, whitelist: [], blacklist: ['users'] })
    expect(store.offer(call('http://a/index.html'))).toBe(true)
    expect(store.offer(call('http://a/api/users'))).toBe(false)
    expect(store.getFilters('s1').blacklist).toEqual(['users'])
  })

  it('applying the lists to what is stored is destructive and reported', () => {
    const store = recordingStore()
    store.offer(call('http://a/api/users'))
    store.offer(call('http://a/index.html'))
    store.offer(call('http://a/assets/app.js'))
    const removed: string[][] = []
    store.on('captures-removed', (payload) => { removed.push(payload.ids) })
    store.setFilters('s1', { ...ALL, whitelist: ['/api/'], blacklist: [] })
    expect(store.list('s1')).toHaveLength(3)
    const dropped = store.applyFiltersToExisting('s1')
    expect(dropped).toHaveLength(2)
    expect(removed).toEqual([dropped])
    expect(store.list('s1').map((c) => c.url)).toEqual(['http://a/api/users'])
  })
})

describe('recording capture store — cap and eviction', () => {
  it('evicts the oldest calls beyond the cap and announces them', () => {
    const store = recordingStore()
    store.setCap(3)
    const removed: string[] = []
    store.on('captures-removed', (payload) => { removed.push(...payload.ids) })
    for (let i = 0; i < 5; i++) store.offer(call(`http://a/${i}`))
    expect(store.list('s1').map((c) => c.url)).toEqual(['http://a/2', 'http://a/3', 'http://a/4'])
    expect(removed).toHaveLength(2)
  })

  it('lowering the cap evicts right away', () => {
    const store = recordingStore()
    for (let i = 0; i < 5; i++) store.offer(call(`http://a/${i}`))
    store.setCap(2)
    expect(store.list('s1').map((c) => c.url)).toEqual(['http://a/3', 'http://a/4'])
    expect(store.getCap()).toBe(2)
  })
})

describe('recording capture store — runs, details and events', () => {
  it('lists light summaries and serves the full detail on demand', () => {
    const store = recordingStore()
    const detail = call('http://a/x?page=2', { request: { headers: [{ key: 'X', value: 'y' }], query: [{ key: 'page', value: '2' }], body: null } })
    store.offer(detail)
    const [row] = store.list('s1')
    expect(row).not.toHaveProperty('request')
    expect(row).not.toHaveProperty('response')
    expect(summaryOf(detail)).not.toHaveProperty('request')
    expect(store.get('s1', detail.id)?.request.headers).toEqual([{ key: 'X', value: 'y' }])
    expect(store.get('s1', 'nope')).toBeNull()
  })

  it('emits capture-added with the summary and capture-updated on mutation', () => {
    const store = recordingStore()
    const added: string[] = []
    const updated: number[] = []
    store.on('capture-added', (s) => { added.push(s.url) })
    store.on('capture-updated', (s) => { updated.push(s.status ?? -1) })
    const c = call('http://a/ws', { protocol: 'websocket', method: 'WS', status: undefined })
    store.offer(c)
    expect(store.update('s1', c.id, (live) => { live.status = 101 })).toBe(true)
    expect(added).toEqual(['http://a/ws'])
    expect(updated).toEqual([101])
    expect(store.update('s1', 'ghost', () => undefined)).toBe(false)
  })

  it('ends the run on stop, keeps its captures, and a new start opens a new run', () => {
    const store = recordingStore()
    store.offer(call('http://a/1'))
    const ended = store.endRun('s1')
    expect(ended?.endedAt).not.toBeNull()
    expect(store.status('s1').state).toBe('idle')
    expect(store.list('s1')).toHaveLength(1)
    expect(store.offer(call('http://a/2'))).toBe(false)
    const second = store.startRun('s1', 'http://localhost:8080/', 'tab-2', ALL)
    store.offer(call('http://a/3'))
    expect(store.runs('s1')).toHaveLength(2)
    expect(store.list('s1').map((c) => c.runId)).toEqual([ended?.id, second.id])
  })

  it('clears one run — even the live one — and forgets a finished run', () => {
    const store = recordingStore()
    store.offer(call('http://a/1'))
    const first = store.endRun('s1')
    const second = store.startRun('s1', 'http://localhost:8080/', 'tab-1', ALL)
    store.offer(call('http://a/2'))
    store.offer(call('http://a/3'))
    const removedRuns: string[] = []
    store.on('run-removed', (payload) => { removedRuns.push(payload.runId) })
    expect(store.clearRun('s1', second.id)).toHaveLength(2)
    // The live run is replaced by a fresh one: the cleared group is gone,
    // the recording goes on.
    const fresh = store.runs('s1')[1]
    expect(store.runs('s1').map((r) => r.id)).toEqual([first?.id, fresh?.id])
    expect(fresh?.id).not.toBe(second.id)
    expect(store.status('s1')).toMatchObject({ state: 'recording', runId: fresh?.id })
    expect(store.clearRun('s1', first?.id ?? '')).toHaveLength(1)
    expect(store.runs('s1').map((r) => r.id)).toEqual([fresh?.id])
    expect(removedRuns).toEqual([second.id, first?.id])
    expect(store.list('s1')).toEqual([])
  })

  it('removes specific captures and whole sessions', () => {
    const store = recordingStore()
    const a = call('http://a/1'); const b = call('http://a/2')
    store.offer(a); store.offer(b)
    expect(store.removeCaptures('s1', [a.id, 'ghost'])).toEqual([a.id])
    store.clearSession('s1')
    expect(store.list('s1')).toEqual([])
    expect(store.status('s1').state).toBe('idle')
  })
})
