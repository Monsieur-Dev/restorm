/**
 * Shared on-disk history archive — a single ZIP sidecar next to the
 * project file (`<project>.responses.zip`) that holds BOTH the per-request
 * response history (under `responses/`, indexed by `requests`) and the
 * per-scenario run history (under `scenarioRuns/`, indexed by
 * `scenarios`). A single `index.json` (version 2) lists both slices.
 *
 * Both domains (ResponseHistoryService + ScenarioRunHistoryService) route
 * every mutation through `queueHistoryWrite`, so writes never interleave —
 * a scenario run completing while its requests are still recording can't
 * clobber the archive. Each writer reads the whole archive, edits only its
 * slice, and writes everything back (preserving the other domain's
 * entries), so the shared queue is the only coordination they need.
 */
import { existsSync, statSync, promises as fs } from 'fs'
import { join } from 'path'
import {
  ZipReader,
  ZipWriter,
  TextReader,
  TextWriter,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  configure
} from '@zip.js/zip.js'
import {
  logger,
  getFileService,
  isFileServiceInitialized
} from 'electron-core-ui/main'
import type { ResponseHistoryEntry } from '../../shared/types/responseHistory'
import type { ScenarioRunHistoryEntry } from '../../shared/types/scenarioRunHistory'

configure({
  useWebWorkers: false,
  useCompressionStream: false
})

export const INDEX_FILE_NAME = 'index.json'
export const RESPONSES_FOLDER = 'responses'
export const SCENARIO_RUNS_FOLDER = 'scenarioRuns'

export interface HistoryArchiveRequestSlice {
  requestId: string
  entries: ResponseHistoryEntry[]
}

export interface HistoryArchiveScenarioSlice {
  scenarioId: string
  runs: ScenarioRunHistoryEntry[]
}

export interface HistoryArchiveIndex {
  version: 2
  requests: HistoryArchiveRequestSlice[]
  scenarios: HistoryArchiveScenarioSlice[]
}

export function emptyHistoryIndex(): HistoryArchiveIndex {
  return { version: 2, requests: [], scenarios: [] }
}

/** Path to the project's history archive, or null when no file is open
 * (in-memory-only mode). A directory-structure project keeps the archive
 * inside the folder; a single-file project uses a `<file>.responses.zip`
 * sibling. */
export function getHistoryArchivePath(): string | null {
  if (!isFileServiceInitialized()) return null
  const filePath = getFileService().getFilePath()
  if (!filePath) return null
  try {
    const isDirectory = existsSync(filePath) && statSync(filePath).isDirectory()
    if (isDirectory) {
      return join(filePath, 'responses.zip')
    }
    return `${filePath}.responses.zip`
  } catch {
    return `${filePath}.responses.zip`
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseResponseEntry(raw: Record<string, unknown>): ResponseHistoryEntry | null {
  const guid = typeof raw['guid'] === 'string' ? raw['guid'] : ''
  const timestamp = typeof raw['timestamp'] === 'string' ? raw['timestamp'] : ''
  const pinned = typeof raw['pinned'] === 'boolean' ? raw['pinned'] : false
  const success = typeof raw['success'] === 'boolean' ? raw['success'] : false
  if (!guid || !timestamp) return null
  const rawOutcome = raw['outcome']
  const outcome = rawOutcome === 'ok' || rawOutcome === 'warning' || rawOutcome === 'failure' ? rawOutcome : undefined
  return outcome ? { guid, timestamp, pinned, success, outcome } : { guid, timestamp, pinned, success }
}

function parseScenarioRun(raw: Record<string, unknown>): ScenarioRunHistoryEntry | null {
  const guid = typeof raw['guid'] === 'string' ? raw['guid'] : ''
  const timestamp = typeof raw['timestamp'] === 'string' ? raw['timestamp'] : ''
  if (!guid || !timestamp) return null
  const pinned = typeof raw['pinned'] === 'boolean' ? raw['pinned'] : false
  const rawStatus = raw['status']
  const status = rawStatus === 'completed' || rawStatus === 'cancelled' || rawStatus === 'failed' ? rawStatus : 'completed'
  const scenarioName = typeof raw['scenarioName'] === 'string' ? raw['scenarioName'] : ''
  return { guid, timestamp, pinned, status, scenarioName }
}

function parseIndex(text: string): HistoryArchiveIndex | null {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!isRecord(parsed)) return null
    // Only v2 archives are supported (the requestId-keyed response format).
    // An optional `scenarios` slice is additive — archives written before
    // scenario history simply omit it and read back as an empty slice.
    if (parsed['version'] !== 2) return null
    if (!Array.isArray(parsed['requests'])) return null

    const requests = parsed['requests']
      .filter(isRecord)
      .map((req) => {
        const requestId = typeof req['requestId'] === 'string' ? req['requestId'] : ''
        const entriesRaw = Array.isArray(req['entries']) ? req['entries'] : []
        const entries = entriesRaw
          .filter(isRecord)
          .map(parseResponseEntry)
          .filter((e): e is ResponseHistoryEntry => e !== null)
        return requestId ? { requestId, entries } : null
      })
      .filter((r): r is HistoryArchiveRequestSlice => r !== null)

    const scenariosRaw = Array.isArray(parsed['scenarios']) ? parsed['scenarios'] : []
    const scenarios = scenariosRaw
      .filter(isRecord)
      .map((scn) => {
        const scenarioId = typeof scn['scenarioId'] === 'string' ? scn['scenarioId'] : ''
        const runsRaw = Array.isArray(scn['runs']) ? scn['runs'] : []
        const runs = runsRaw
          .filter(isRecord)
          .map(parseScenarioRun)
          .filter((r): r is ScenarioRunHistoryEntry => r !== null)
        return scenarioId ? { scenarioId, runs } : null
      })
      .filter((s): s is HistoryArchiveScenarioSlice => s !== null)

    return { version: 2, requests, scenarios }
  } catch {
    return null
  }
}

/** Read the whole archive: the parsed index + every entry's raw text
 * (keyed by zip path). Returns an empty archive when the file is absent. */
export async function readHistoryArchive(
  archivePath: string
): Promise<{ index: HistoryArchiveIndex; entriesData: Map<string, string> }> {
  if (!existsSync(archivePath)) {
    return { index: emptyHistoryIndex(), entriesData: new Map() }
  }

  const buffer = await fs.readFile(archivePath)
  const reader = new ZipReader(new Uint8ArrayReader(buffer))
  const entries = (await reader.getEntries()) as { filename?: string; getData: (writer: TextWriter) => Promise<string> }[]
  const entriesData = new Map<string, string>()
  let index = emptyHistoryIndex()

  for (const entry of entries) {
    if (!entry.filename) continue
    const raw = await entry.getData(new TextWriter())
    const text = typeof raw === 'string' ? raw : ''
    entriesData.set(entry.filename, text)
    if (entry.filename === INDEX_FILE_NAME) {
      const parsed = parseIndex(text)
      if (parsed) index = parsed
      else logger.warn('[historyArchive] Failed to parse index.json')
    }
  }
  await reader.close()

  return { index, entriesData }
}

/** Atomically rewrite the archive (write a sibling tmp file then rename
 * over the live one) so a concurrent reader never sees a half-written
 * zip. `entriesData` is the COMPLETE set of non-index entries to keep. */
export async function writeHistoryArchive(
  archivePath: string,
  index: HistoryArchiveIndex,
  entriesData: Map<string, string>
): Promise<void> {
  const writer = new ZipWriter(new Uint8ArrayWriter())
  await writer.add(INDEX_FILE_NAME, new TextReader(JSON.stringify(index)))
  for (const [entryName, entryText] of entriesData.entries()) {
    if (entryName === INDEX_FILE_NAME) continue
    await writer.add(entryName, new TextReader(entryText))
  }
  const data = await writer.close()
  const tmpPath = `${archivePath}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(tmpPath, Buffer.from(data))
  await fs.rename(tmpPath, archivePath)
}

// Single write queue shared by every domain that mutates the archive, so
// a response write + a scenario-run write can never interleave.
let writeQueue: Promise<unknown> = Promise.resolve()
export function queueHistoryWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(fn, fn)
  writeQueue = next.then(() => undefined, () => undefined)
  return next
}
