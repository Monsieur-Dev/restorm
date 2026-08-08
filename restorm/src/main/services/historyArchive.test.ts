import { describe, it, expect, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { promises as fs } from 'fs'

vi.mock('electron-core-ui/main', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
  getFileService: () => ({ getFilePath: () => null }),
  isFileServiceInitialized: () => false
}))

import {
  readHistoryArchive,
  writeHistoryArchive,
  RESPONSES_FOLDER,
  SCENARIO_RUNS_FOLDER,
  type HistoryArchiveIndex
} from './historyArchive'

function tmpZip(): string {
  return join(tmpdir(), `restorm-hist-${process.pid}-${Math.floor(performance.now())}.zip`)
}

describe('historyArchive', () => {
  it('round-trips the requests + scenarios slices and their entries', async () => {
    const path = tmpZip()
    try {
      const index: HistoryArchiveIndex = {
        version: 2,
        requests: [{ requestId: 'r1', entries: [{ guid: 'g1', timestamp: '2026-01-01T00:00:00Z', pinned: false, outcome: 'ok' }] }],
        scenarios: [{ scenarioId: 's1', runs: [{ guid: 'sr1', timestamp: '2026-01-02T00:00:00Z', pinned: true, status: 'completed', scenarioName: 'Fight' }] }]
      }
      const entries = new Map<string, string>([
        [`${RESPONSES_FOLDER}/g1.json`, '{"guid":"g1"}'],
        [`${SCENARIO_RUNS_FOLDER}/sr1.json`, '{"guid":"sr1"}']
      ])
      await writeHistoryArchive(path, index, entries)

      const back = await readHistoryArchive(path)
      expect(back.index.requests).toHaveLength(1)
      expect(back.index.scenarios).toHaveLength(1)
      expect(back.index.scenarios[0]?.runs[0]?.scenarioName).toBe('Fight')
      expect(back.index.scenarios[0]?.runs[0]?.pinned).toBe(true)
      expect(back.entriesData.get(`${RESPONSES_FOLDER}/g1.json`)).toBe('{"guid":"g1"}')
      expect(back.entriesData.get(`${SCENARIO_RUNS_FOLDER}/sr1.json`)).toBe('{"guid":"sr1"}')
    } finally {
      await fs.rm(path, { force: true })
    }
  })

  it('reads a v2 archive without a scenarios slice as an empty slice (back-compat)', async () => {
    const path = tmpZip()
    try {
      // Simulate a legacy archive written before scenario history existed.
      await writeHistoryArchive(path, { version: 2, requests: [] } as unknown as HistoryArchiveIndex, new Map())
      const back = await readHistoryArchive(path)
      expect(back.index.scenarios).toEqual([])
    } finally {
      await fs.rm(path, { force: true })
    }
  })

  it('returns an empty archive for a missing file', async () => {
    const back = await readHistoryArchive(join(tmpdir(), 'restorm-hist-does-not-exist.zip'))
    expect(back.index.requests).toEqual([])
    expect(back.index.scenarios).toEqual([])
    expect(back.entriesData.size).toBe(0)
  })
})
