import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ScenarioRunHistoryEntry } from '../../../src/shared/types/scenarioRunHistory'

vi.mock('crypto', () => {
  let c = 0
  const m = { randomUUID: vi.fn(() => { c++; return 'run-' + String(c).padStart(4, '0') }) }
  return { ...m, default: m }
})

// The cap the service reads through `historyRetention`. Mutable so a test can
// change it and assert the retention follows the setting.
const settingsState = vi.hoisted(() => ({
  historyMaxEntries: 10 as unknown,
  listeners: new Map<string, (value: unknown) => void>()
}))

vi.mock('electron-core-ui/main', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  isSettingsServiceInitialized: vi.fn().mockReturnValue(true),
  getSettingsService: vi.fn(() => ({
    get: () => settingsState.historyMaxEntries,
    onSettingChanged: (key: string, listener: (value: unknown) => void) => {
      settingsState.listeners.set(key, listener)
      return () => { settingsState.listeners.delete(key) }
    }
  }))
}))

// All archive I/O goes through the shared `historyArchive` module, so drive a
// store-backed stand-in rather than a real zip on disk.
vi.mock('../../../src/main/services/historyArchive', () => ({
  getHistoryArchivePath: vi.fn(),
  readHistoryArchive: vi.fn(),
  writeHistoryArchive: vi.fn(),
  queueHistoryWrite: vi.fn(),
  INDEX_FILE_NAME: 'index.json',
  RESPONSES_FOLDER: 'responses',
  SCENARIO_RUNS_FOLDER: 'scenarioRuns'
}))

import { scenarioRunHistoryService } from '../../../src/main/services/ScenarioRunHistoryService'
import {
  getHistoryArchivePath,
  readHistoryArchive,
  writeHistoryArchive,
  queueHistoryWrite,
  type HistoryArchiveIndex
} from '../../../src/main/services/historyArchive'

const AP = '/tmp/project.responses.zip'
let store: Map<string, Map<string, string>>

function getIdx(p: string): HistoryArchiveIndex | null {
  const text = store.get(p)?.get('index.json')
  return text ? (JSON.parse(text) as HistoryArchiveIndex) : null
}

/** Seed the archive with runs for one scenario, plus their detail payloads. */
function seed(runs: { guid: string; timestamp: string; pinned?: boolean }[]): void {
  const entries: ScenarioRunHistoryEntry[] = runs.map((r) => ({
    guid: r.guid,
    scenarioName: 'Scenario',
    timestamp: r.timestamp,
    endedAt: r.timestamp,
    status: 'success',
    pinned: r.pinned ?? false
  }))
  const d = new Map<string, string>()
  d.set('index.json', JSON.stringify({
    version: 2,
    requests: [],
    scenarios: [{ scenarioId: 'scn-1', runs: entries }]
  }))
  for (const r of runs) d.set(`scenarioRuns/${r.guid}.json`, JSON.stringify({ guid: r.guid }))
  store.set(AP, d)
}

function mkRun(startedAt: string): Parameters<typeof scenarioRunHistoryService.storeRun>[0] {
  return {
    scenarioId: 'scn-1',
    scenarioName: 'Scenario',
    startedAt,
    endedAt: startedAt,
    status: 'success',
    scenarios: [],
    log: []
  }
}

describe('ScenarioRunHistoryService retention', () => {
  beforeEach(() => {
    store = new Map()
    settingsState.historyMaxEntries = 10
    settingsState.listeners.clear()

    vi.mocked(getHistoryArchivePath).mockReturnValue(AP)
    vi.mocked(queueHistoryWrite).mockImplementation((fn) => fn())
    vi.mocked(readHistoryArchive).mockImplementation((p: string) => {
      const d = store.get(p)
      if (!d) {
        return Promise.resolve({
          index: { version: 2 as const, requests: [], scenarios: [] },
          entriesData: new Map<string, string>()
        })
      }
      const it = d.get('index.json')
      const idx: HistoryArchiveIndex = it
        ? (JSON.parse(it) as HistoryArchiveIndex)
        : { version: 2, requests: [], scenarios: [] }
      return Promise.resolve({ index: idx, entriesData: new Map(d) })
    })
    vi.mocked(writeHistoryArchive).mockImplementation((p: string, idx: HistoryArchiveIndex, ed: Map<string, string>) => {
      const d = new Map<string, string>()
      d.set('index.json', JSON.stringify(idx))
      for (const [k, v] of ed) { if (k !== 'index.json') d.set(k, v) }
      store.set(p, d)
      return Promise.resolve()
    })
  })

  it('caps stored runs at the configured setting, not a hardcoded number', async () => {
    settingsState.historyMaxEntries = 3
    for (let i = 0; i < 6; i++) {
      await scenarioRunHistoryService.storeRun(mkRun(`2026-01-15T10:00:0${String(i)}.000Z`))
    }
    const runs = getIdx(AP)?.scenarios[0]?.runs ?? []
    expect(runs).toHaveLength(3)
    expect(runs.map((r) => r.timestamp).sort()).toEqual([
      '2026-01-15T10:00:03.000Z',
      '2026-01-15T10:00:04.000Z',
      '2026-01-15T10:00:05.000Z'
    ])
  })

  it('raising the setting lets more runs accumulate', async () => {
    settingsState.historyMaxEntries = 12
    for (let i = 0; i < 12; i++) {
      await scenarioRunHistoryService.storeRun(mkRun(`2026-01-15T10:00:${String(i).padStart(2, '0')}.000Z`))
    }
    expect(getIdx(AP)?.scenarios[0]?.runs).toHaveLength(12)
  })

  it('never truncates pinned runs, however low the setting goes', async () => {
    settingsState.historyMaxEntries = 1
    seed([
      { guid: 'pin-1', timestamp: '2026-01-15T09:00:00.000Z', pinned: true },
      { guid: 'pin-2', timestamp: '2026-01-15T09:00:01.000Z', pinned: true },
      { guid: 'loose', timestamp: '2026-01-15T09:00:02.000Z' }
    ])
    await scenarioRunHistoryService.storeRun(mkRun('2026-01-15T10:00:00.000Z'))

    const runs = getIdx(AP)?.scenarios[0]?.runs ?? []
    const guids = runs.map((r) => r.guid)
    expect(guids).toContain('pin-1')
    expect(guids).toContain('pin-2')
    expect(guids).not.toContain('loose')
    expect(runs.filter((r) => !r.pinned)).toHaveLength(1)
  })

  it('pruneToLimit shrinks an ALREADY-filled archive and drops the orphaned payloads', async () => {
    seed([
      { guid: 'r1', timestamp: '2026-01-15T09:00:01.000Z' },
      { guid: 'r2', timestamp: '2026-01-15T09:00:02.000Z' },
      { guid: 'r3', timestamp: '2026-01-15T09:00:03.000Z' },
      { guid: 'r4', timestamp: '2026-01-15T09:00:04.000Z' },
      { guid: 'p1', timestamp: '2026-01-15T09:00:00.000Z', pinned: true }
    ])

    await scenarioRunHistoryService.pruneToLimit(2)

    const runs = getIdx(AP)?.scenarios[0]?.runs ?? []
    const guids = runs.map((r) => r.guid)
    expect(runs).toHaveLength(3)
    expect(guids).toEqual(expect.arrayContaining(['r4', 'r3', 'p1']))
    expect(guids).not.toContain('r1')
    expect(guids).not.toContain('r2')
    expect(store.get(AP)?.has('scenarioRuns/r1.json')).toBe(false)
    expect(store.get(AP)?.has('scenarioRuns/r4.json')).toBe(true)
  })

  it('pruneToLimit leaves an archive already within the cap untouched', async () => {
    seed([
      { guid: 'r1', timestamp: '2026-01-15T09:00:01.000Z' },
      { guid: 'r2', timestamp: '2026-01-15T09:00:02.000Z' }
    ])
    vi.mocked(writeHistoryArchive).mockClear()

    await scenarioRunHistoryService.pruneToLimit(10)

    expect(writeHistoryArchive).not.toHaveBeenCalled()
    expect(getIdx(AP)?.scenarios[0]?.runs).toHaveLength(2)
  })

  it('preserves the responses/ slice it does not own', async () => {
    seed([
      { guid: 'r1', timestamp: '2026-01-15T09:00:01.000Z' },
      { guid: 'r2', timestamp: '2026-01-15T09:00:02.000Z' },
      { guid: 'r3', timestamp: '2026-01-15T09:00:03.000Z' }
    ])
    store.get(AP)?.set('responses/keep-me.json', '{"guid":"keep-me"}')

    await scenarioRunHistoryService.pruneToLimit(1)

    expect(store.get(AP)?.has('responses/keep-me.json')).toBe(true)
  })
})
