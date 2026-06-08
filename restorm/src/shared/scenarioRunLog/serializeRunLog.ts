/**
 * Single source of truth for serializing a scenario run-log to the plain-text
 * YAML form — the exact output of the inspector's "copy logs" button AND the
 * headless CLI runner's console / file output. Keeping ONE serializer here
 * guarantees the CLI stream is byte-identical to a copy-paste from the
 * inspector (same per-entry shape, same emoji/date format), instead of two
 * implementations drifting apart.
 *
 * Pure module: depends only on `yaml` (no renderer, no electron) so it imports
 * cleanly into both the renderer component and the main-process CLI.
 */
import { stringify as yamlStringify } from 'yaml'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** Status-dot colour rendered as an emoji for the plain-text (YAML) copy, so a
 * pasted/streamed log keeps the level cue without the styled `<span>` dot. */
export const LEVEL_EMOJI: Record<LogLevel, string> = { debug: '⚪', info: '🔵', warn: '🟠', error: '🔴' }

/** Minimal log-entry shape the serializer needs — satisfied by both the live
 * `ScenarioLogEntry` (inspector) and the persisted `ScenarioRunLogEntry`
 * (run history), and by the engine's `RunLogEntry` (CLI). */
export interface ScenarioRunLogLike {
  ts: string
  level?: LogLevel
  source?: 'engine' | 'user' | 'run'
  /** The node that emitted this entry. */
  nodeId?: string
  /** The (sub-)scenario the entry came from. */
  scenarioId?: string
  message: string
  data?: unknown
}

/** Full, human-readable timestamp for the copied log (`YYYY-MM-DD HH:MM:SS.mmm`)
 * — unlike the row's time-only display, a pasted log may be read across days. */
export const logDate = (ts: string): string => (ts.length >= 23 ? ts.slice(0, 23).replace('T', ' ') : ts)

/** Defensive: a log `message` may arrive as a non-string (e.g. a typed
 * ValueType `{ type, value }`); never serialize a raw object as the message. */
export const asText = (v: unknown): string => {
  if (typeof v === 'string') return v
  if (v === null || v === undefined) return ''
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  try { return JSON.stringify(v) } catch { return '[unserializable]' }
}

/** The YAML object for one entry: a single `message` line
 * (`<level-emoji> [<date>] <text>`) and, when present, the structured `data`
 * as a second property. */
function toYamlEntry(e: ScenarioRunLogLike): { message: string } | { message: string; data: unknown } {
  const level = e.level ?? 'info'
  const message = `${LEVEL_EMOJI[level]} [${logDate(e.ts)}] ${asText(e.message)}`
  return e.data !== undefined ? { message, data: e.data } : { message }
}

/** "Show all" filter: unchecked = only the user-produced `Log` action entries
 * (engine `debug` + `run` boundaries are "system"). Same predicate the
 * inspector's `visibleLogs` uses for its source dimension. */
export function filterUserLogs<T extends ScenarioRunLogLike>(logs: readonly T[], showAll: boolean): T[] {
  return showAll ? [...logs] : logs.filter((e) => e.source === 'user')
}

// `aliasDuplicateObjects: false` writes every value in full instead of emitting
// YAML anchors/aliases (`&a1` / `*a1`) when the SAME object reference recurs.
// In-process the engine can hand the same `data` object to several entries
// (shared refs), which would otherwise produce anchors the renderer's
// (post-clone) output never has — keeping both byte-identical.
// `lineWidth: 0` disables wrapping so a long log message stays on one line
// (greppable raw CLI output, and stable regardless of timestamp length).
const YAML_OPTS = { aliasDuplicateObjects: false, lineWidth: 0 } as const

/** Serialize a batch of entries to YAML (the inspector "copy all logs" output).
 * Returns `''` if YAML stringification somehow throws, matching the inspector. */
export function serializeRunLogEntries(entries: readonly ScenarioRunLogLike[]): string {
  try { return yamlStringify(entries.map(toYamlEntry), YAML_OPTS) } catch { return '' }
}

/** Serialize ONE entry to YAML (the inspector per-row "copy entry" output).
 * The streamed-per-entry form for the CLI uses {@link serializeRunLogEntries}
 * with a single-element array so the leading `- ` + indentation match the
 * batch copy exactly. */
export function serializeRunLogEntry(entry: ScenarioRunLogLike): string {
  try { return yamlStringify(toYamlEntry(entry), YAML_OPTS) } catch { return '' }
}
