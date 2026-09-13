/**
 * In-memory store of the calls captured by recording sessions.
 *
 * Lives in the main process only. Nothing here is persisted or mirrored
 * wholesale to the renderer: the renderer gets light summaries as they
 * happen and fetches one detail at a time. A session's captures are
 * bounded by a cap (an app setting, default 1000) — the oldest go first.
 *
 * The store is also the filter gate: a call is stored only when the
 * session is recording (not paused), its protocol is enabled, and its url
 * passes the white / black lists. Changing the lists mid-recording takes
 * effect on the next call; applying them to what is already stored is a
 * separate, destructive step the UI confirms first.
 *
 * Electron-free on purpose so it unit-tests without the runtime; the IPC
 * layer subscribes to its events and forwards them to the windows.
 */

import { EventEmitter } from 'node:events'
import type {
  RecordedCallDetail,
  RecordedCallSummary,
  RecordingFilterConfig,
  RecordingRun,
  RecordingStatus
} from '../../../shared/types/recordingCapture'
import type { RecordingProtocol } from '../../../shared/types/recordingSession'
import { compileFilters, passesFilters, type CompiledFilters } from '../../../shared/recording/captureFilters'

export const DEFAULT_CAPTURE_CAP = 1000

export interface RecordingStoreEvents {
  'capture-added': RecordedCallSummary
  'capture-updated': RecordedCallSummary
  'captures-removed': { sessionId: string; ids: string[] }
  'run-changed': RecordingRun
  'run-removed': { sessionId: string; runId: string }
  'status-changed': RecordingStatus
}

interface SessionState {
  runs: RecordingRun[]
  /** Insertion order = chronological order; eviction pops the oldest. */
  calls: Map<string, RecordedCallDetail>
  config: RecordingFilterConfig
  filters: CompiledFilters
  paused: boolean
  activeRunId: string | null
  tabId: string | null
}

const SUMMARY_KEYS: readonly (keyof RecordedCallSummary)[] = [
  'id', 'sessionId', 'runId', 'protocol', 'timestamp', 'method', 'url', 'resourceType',
  'status', 'statusText', 'durationMs', 'mimeType', 'responseSize', 'error', 'graphql', 'grpc', 'websocket'
]

/** The light row of a call — everything but headers, bodies and frames. */
export function summaryOf(detail: RecordedCallDetail): RecordedCallSummary {
  const out: Record<string, unknown> = {}
  for (const key of SUMMARY_KEYS) {
    const value = detail[key]
    if (value !== undefined) out[key] = value
  }
  return out as unknown as RecordedCallSummary
}

let runCounter = 0
function newRunId(): string {
  runCounter += 1
  return `run-${Date.now().toString(36)}-${runCounter.toString(36)}`
}

export class RecordingCaptureStore {
  private readonly sessions = new Map<string, SessionState>()
  private readonly emitter = new EventEmitter()
  private cap = DEFAULT_CAPTURE_CAP

  on<K extends keyof RecordingStoreEvents>(event: K, listener: (payload: RecordingStoreEvents[K]) => void): () => void {
    this.emitter.on(event, listener)
    return () => { this.emitter.off(event, listener) }
  }

  private emit<K extends keyof RecordingStoreEvents>(event: K, payload: RecordingStoreEvents[K]): void {
    this.emitter.emit(event, payload)
  }

  /** The per-session cap. Lowering it evicts the oldest calls right away. */
  setCap(cap: number): void {
    this.cap = Math.max(1, Math.floor(cap))
    for (const [sessionId, state] of this.sessions) this.evictToCap(sessionId, state)
  }

  getCap(): number {
    return this.cap
  }

  private ensure(sessionId: string): SessionState {
    let state = this.sessions.get(sessionId)
    if (!state) {
      const config: RecordingFilterConfig = { protocols: ['http', 'websocket', 'graphql', 'grpc-web'], whitelist: [], blacklist: [] }
      state = {
        runs: [],
        calls: new Map(),
        config,
        filters: compileFilters(config.whitelist, config.blacklist),
        paused: false,
        activeRunId: null,
        tabId: null
      }
      this.sessions.set(sessionId, state)
    }
    return state
  }

  // ---------------------------------------------------------------------
  // Runs / recording state
  // ---------------------------------------------------------------------

  startRun(sessionId: string, url: string, tabId: string, config: RecordingFilterConfig): RecordingRun {
    const state = this.ensure(sessionId)
    if (state.activeRunId !== null) this.endRun(sessionId)
    const run: RecordingRun = { id: newRunId(), sessionId, url, startedAt: Date.now(), endedAt: null }
    state.runs.push(run)
    state.activeRunId = run.id
    state.tabId = tabId
    state.paused = false
    this.applyConfig(state, config)
    this.emit('run-changed', run)
    this.emit('status-changed', this.status(sessionId))
    return run
  }

  endRun(sessionId: string): RecordingRun | null {
    const state = this.sessions.get(sessionId)
    if (state === undefined) return null
    if (state.activeRunId === null) return null
    const run = state.runs.find((r) => r.id === state.activeRunId)
    state.activeRunId = null
    state.tabId = null
    state.paused = false
    if (run) {
      run.endedAt = Date.now()
      this.emit('run-changed', run)
    }
    this.emit('status-changed', this.status(sessionId))
    return run ?? null
  }

  setPaused(sessionId: string, paused: boolean): void {
    const state = this.sessions.get(sessionId)
    if (state === undefined) return
    if (state.activeRunId === null || state.paused === paused) return
    state.paused = paused
    this.emit('status-changed', this.status(sessionId))
  }

  status(sessionId: string): RecordingStatus {
    const state = this.sessions.get(sessionId)
    if (!state) return { sessionId, state: 'idle', runId: null, tabId: null, captureCount: 0 }
    return {
      sessionId,
      state: state.activeRunId === null ? 'idle' : state.paused ? 'paused' : 'recording',
      runId: state.activeRunId,
      tabId: state.tabId,
      captureCount: state.calls.size
    }
  }

  runs(sessionId: string): RecordingRun[] {
    return [...(this.sessions.get(sessionId)?.runs ?? [])]
  }

  // ---------------------------------------------------------------------
  // Filters
  // ---------------------------------------------------------------------

  private applyConfig(state: SessionState, config: RecordingFilterConfig): void {
    state.config = { protocols: [...config.protocols], whitelist: [...config.whitelist], blacklist: [...config.blacklist] }
    state.filters = compileFilters(state.config.whitelist, state.config.blacklist)
  }

  /** Live update of the gate — affects the NEXT calls only. */
  setFilters(sessionId: string, config: RecordingFilterConfig): void {
    this.applyConfig(this.ensure(sessionId), config)
  }

  getFilters(sessionId: string): RecordingFilterConfig {
    const state = this.ensure(sessionId)
    return { protocols: [...state.config.protocols], whitelist: [...state.config.whitelist], blacklist: [...state.config.blacklist] }
  }

  /** The destructive step: drop every stored call the current lists (and
   * protocol set) would not have kept. Returns the removed ids. */
  applyFiltersToExisting(sessionId: string): string[] {
    const state = this.sessions.get(sessionId)
    if (!state) return []
    const removed: string[] = []
    for (const [id, call] of state.calls) {
      if (!this.accepts(state, call.protocol, call.url)) {
        state.calls.delete(id)
        removed.push(id)
      }
    }
    if (removed.length > 0) {
      this.emit('captures-removed', { sessionId, ids: removed })
      this.emit('status-changed', this.status(sessionId))
    }
    return removed
  }

  private accepts(state: SessionState, protocol: RecordingProtocol, url: string): boolean {
    return state.config.protocols.includes(protocol) && passesFilters(url, state.filters)
  }

  /** Whether a call with this protocol + url would be stored right now
   * (recording, not paused, protocol on, lists pass). The engine asks this
   * BEFORE fetching bodies, so filtered-out traffic costs nothing. */
  wouldAccept(sessionId: string, protocol: RecordingProtocol, url: string): boolean {
    const state = this.sessions.get(sessionId)
    if (state === undefined) return false
    if (state.activeRunId === null || state.paused) return false
    return this.accepts(state, protocol, url)
  }

  // ---------------------------------------------------------------------
  // Captures
  // ---------------------------------------------------------------------

  /** Store a finished (or still-open, for WebSocket) call. Returns `false`
   * when the gate refused it. */
  offer(detail: RecordedCallDetail): boolean {
    const state = this.sessions.get(detail.sessionId)
    if (state === undefined) return false
    if (state.activeRunId === null || state.paused) return false
    if (!this.accepts(state, detail.protocol, detail.url)) return false
    const stamped: RecordedCallDetail = { ...detail, runId: state.activeRunId }
    state.calls.set(stamped.id, stamped)
    this.evictToCap(detail.sessionId, state)
    if (state.calls.has(stamped.id)) {
      this.emit('capture-added', summaryOf(stamped))
      this.emit('status-changed', this.status(detail.sessionId))
      return true
    }
    return false
  }

  /** Mutate a stored call in place (a WebSocket frame, a late response).
   * Ignored while paused or once the call was evicted. */
  update(sessionId: string, id: string, mutate: (call: RecordedCallDetail) => void): boolean {
    const state = this.sessions.get(sessionId)
    if (state === undefined) return false
    if (state.paused) return false
    const call = state.calls.get(id)
    if (!call) return false
    mutate(call)
    this.emit('capture-updated', summaryOf(call))
    return true
  }

  has(sessionId: string, id: string): boolean {
    return this.sessions.get(sessionId)?.calls.has(id) ?? false
  }

  list(sessionId: string): RecordedCallSummary[] {
    const state = this.sessions.get(sessionId)
    if (!state) return []
    return [...state.calls.values()].map(summaryOf)
  }

  get(sessionId: string, id: string): RecordedCallDetail | null {
    return this.sessions.get(sessionId)?.calls.get(id) ?? null
  }

  /** Drop every call of one run (the trash button on a level-1 row). The
   * run itself stays listed while it is live, and is forgotten otherwise. */
  /** Drop a run and its calls. The live run cannot really go away while the
   *  recording continues: it is replaced by a fresh, empty run (new id, new
   *  start time) so the group the user cleared disappears and the next
   *  capture opens a new one. */
  clearRun(sessionId: string, runId: string): string[] {
    const state = this.sessions.get(sessionId)
    if (!state) return []
    const removed: string[] = []
    for (const [id, call] of state.calls) {
      if (call.runId === runId) {
        state.calls.delete(id)
        removed.push(id)
      }
    }
    const run = state.runs.find((r) => r.id === runId)
    state.runs = state.runs.filter((r) => r.id !== runId)
    if (removed.length > 0) this.emit('captures-removed', { sessionId, ids: removed })
    if (run !== undefined) this.emit('run-removed', { sessionId, runId })
    if (state.activeRunId === runId && run !== undefined) {
      const fresh: RecordingRun = { id: newRunId(), sessionId, url: run.url, startedAt: Date.now(), endedAt: null }
      state.runs.push(fresh)
      state.activeRunId = fresh.id
      this.emit('run-changed', fresh)
    }
    this.emit('status-changed', this.status(sessionId))
    return removed
  }

  removeCaptures(sessionId: string, ids: readonly string[]): string[] {
    const state = this.sessions.get(sessionId)
    if (!state) return []
    const removed = ids.filter((id) => state.calls.delete(id))
    if (removed.length > 0) {
      this.emit('captures-removed', { sessionId, ids: removed })
      this.emit('status-changed', this.status(sessionId))
    }
    return removed
  }

  /** Forget a session entirely (the tree item was deleted / the project closed). */
  clearSession(sessionId: string): void {
    const state = this.sessions.get(sessionId)
    if (!state) return
    const ids = [...state.calls.keys()]
    this.sessions.delete(sessionId)
    if (ids.length > 0) this.emit('captures-removed', { sessionId, ids })
    this.emit('status-changed', this.status(sessionId))
  }

  /** Every session the store holds state for (captures or a live run). */
  sessionIds(): string[] {
    return [...this.sessions.keys()]
  }

  clearAll(): void {
    for (const sessionId of [...this.sessions.keys()]) this.clearSession(sessionId)
  }

  private evictToCap(sessionId: string, state: SessionState): void {
    const excess = state.calls.size - this.cap
    if (excess <= 0) return
    const evicted: string[] = []
    for (const id of state.calls.keys()) {
      if (evicted.length >= excess) break
      evicted.push(id)
    }
    for (const id of evicted) state.calls.delete(id)
    this.emit('captures-removed', { sessionId, ids: evicted })
  }
}

export const recordingCaptureStore = new RecordingCaptureStore()
