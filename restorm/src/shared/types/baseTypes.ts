import type { RuntimeId } from 'electron-core-ui/types'
import type { ValueType } from './valueTypes'

export type { RuntimeId }

export type IconType =
  | 'emoji'
  | 'codicon'
  | 'iconoir'
  | 'phosphor'
  | 'material'
  | 'simpleicons'
  | 'feather'
  | 'fontawesome'
  | 'none'

export interface Icon {
  type: IconType
  value: string
}

export interface KeyValue {
  id?: RuntimeId | undefined
  key: string
  value: ValueType
  description?: string | undefined
  enabled?: boolean | undefined
}

export interface Environment {
  id: RuntimeId
  name: string
  icon?: Icon
  color?: string
  variables: KeyValue[]
  subEnvironments?: Environment[]
}

export type FolderConfiguration = Record<string, never>

/** Identifies how an EnvironmentFolder was created. */
export type ImportSourceType =
  | 'swagger'
  | 'graphql'
  | 'grpc'
  | 'wsdl'
  | 'asyncapi'
  | 'postman'
  | 'insomnia'
  | 'bruno'
  | 'curl'
  | 'powershell'
  | 'url'

/**
 * How often to poll the source spec for updates. Drives the
 * `Check interval` dropdown on the env folder home page. `'never'`
 * disables auto-check entirely (the user can still trigger a manual
 * `Check now`).
 */
export type ApiUpdateInterval = 'hourly' | 'every6h' | 'daily' | 'weekly' | 'never'

/**
 * Per-env-folder configuration for the periodic spec re-check and
 * idempotent refresh pipeline. Lives on `EnvironmentFolder` and
 * persists alongside the rest of the folder via the existing yaml /
 * json save codecs. Absent on env folders that were not created
 * from an importable source (manual collections), and on legacy
 * folders saved before this field existed — the migration on load
 * backfills it from `apiDocumentation.sourceUrl` when present.
 */
export interface ApiUpdateConfig {
  /** URL the importer fetches when refreshing the spec. Supports
   * `${VAR}` substitution from the env folder's environments. */
  sourceUrl: string
  /** Optional auth headers, also `${VAR}`-expanded at fetch time.
   * Empty / omitted by default. */
  sourceHeaders?: Record<string, string>
  /** When `true`, the scheduler ticks for this folder. */
  autoCheckEnabled: boolean
  /** Stored as a string enum so the config stays human-readable on
   * disk; the scheduler converts it to milliseconds at runtime. */
  interval: ApiUpdateInterval
  /** Epoch ms of the most recent attempt (success or failure).
   * Persisted with debouncing — not written on every tick. */
  lastCheckedAt?: number
  /** `info.version` (or equivalent) of the spec the folder was last
   * imported / refreshed from. */
  lastImportedSpecVersion?: string
  /** Structural content hash of that same spec. Used to detect
   * version-less changes (some specs don't bump `info.version`). */
  lastImportedSpecHash?: string
}

/** Drives `ApiUpdateScheduler`'s tick decision and the home-page UI. */
export const API_UPDATE_INTERVAL_MS: Record<ApiUpdateInterval, number> = {
  hourly: 60 * 60 * 1000,
  every6h: 6 * 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  never: Number.POSITIVE_INFINITY
}

/**
 * Lifecycle of the periodic-update flow for a single env folder. Held
 * in main-process memory (not persisted), pushed through IPC so the
 * renderer can render badges / toasts / spinners off it.
 */
export interface ApiUpdateState {
  /**
   * - `'idle'`: no pending update detected.
   * - `'checking'`: a fetch is in progress.
   * - `'available'`: the latest fetch found a new version. Drives the
   *   folder badge + the "Update available" toast.
   * - `'applying'`: the user clicked Apply; the import pipeline is
   *   running.
   * - `'error'`: the most recent check failed. Surfaces in the toast
   *   on manual triggers, silent on auto.
   */
  kind: 'idle' | 'checking' | 'available' | 'applying' | 'error'
  /** Version currently materialised in the folder (matches
   * `apiUpdate.lastImportedSpecVersion`). */
  currentVersion?: string
  /** Version the latest fetch surfaced. Set when `kind === 'available'`. */
  availableVersion?: string
  /** Pre-computed counters for the confirmation modal. */
  availableDiffSummary?: {
    added: number
    deprecated: number
    removed: number
    modelsChanged: number
  }
  /** Mirrors `apiUpdate.lastCheckedAt` for the renderer. */
  lastCheckedAt?: number
  /** Human-readable error from the most recent check. Cleared on
   * the next successful check. */
  error?: string
}

/**
 * Persisted snapshot of the user's last selective-import choice for an
 * `EnvironmentFolder`. The set `imported ∪ skipped` covers the spec
 * at the time of capture. On a future refresh, keys present in the
 * new spec but absent from both lists are "added", keys in `imported`
 * no longer present are "removed", and keys in `skipped` still
 * present remain skipped (unchecked) by default — that's the
 * primitive that makes the refresh experience tractable.
 *
 * Lives at the env-folder level (one snapshot per folder). Updated
 * on every successful import or refresh-apply.
 */
export interface ImportSelectionSnapshot {
  /** Epoch milliseconds when the snapshot was last refreshed. */
  capturedAt: number
  /** Source of truth — URL or absolute / repo-relative file path. */
  source: string
  /** Spec version captured (`info.version` when available). */
  specVersion?: string
  /** Spec content hash captured at the same time. */
  specHash?: string
  /** Natural keys (routes, models, enums) the user CHOSE to import. */
  imported: string[]
  /** Natural keys present in the spec but the user CHOSE to skip. */
  skipped: string[]
}

/**
 * Rule that matches an enum definition to request URLs/parameters.
 * When a request's URL matches `pathPattern`, the parameter named
 * `paramName` should use the owning EnumDefinition's allowed values.
 */
export interface EnumMatchingRule {
  /** Glob or regex-like pattern for the URL path (e.g. "/pet/findByStatus"). */
  pathPattern: string
  /** HTTP method filter (e.g. "get"). Empty string means any method. */
  method: string
  /** Name of the query/path parameter that uses this enum. */
  paramName: string
}

/**
 * A named set of allowed values for enum parameters.
 * Stored at the EnvironmentFolder level so all requests in the
 * folder can reference the same definition.
 */
export interface EnumDefinition {
  id: RuntimeId
  /** Display name (e.g. "PetStatus", derived from the Swagger schema key). */
  name: string
  /** The closed set of allowed string values. */
  values: string[]
  /** Rules that bind this enum to specific request URL + parameter combos. */
  matchingRules: EnumMatchingRule[]
  /** Enum marked deprecated in the source spec, or carried forward as
   * deprecated across re-imports. */
  deprecated?: boolean
  /** Enum no longer appears in the most recently fetched spec. */
  removed?: boolean
}
