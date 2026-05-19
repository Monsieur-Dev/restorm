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
  | 'openapi'
  | 'graphql'
  | 'grpc'
  | 'wsdl'
  | 'asyncapi'
  | 'odata'
  | 'postman'
  | 'insomnia'
  | 'bruno'
  | 'curl'
  | 'powershell'
  | 'url'

/**
 * Per-env-folder configuration tracking where the folder's spec was
 * imported from and when. Lives on `EnvironmentFolder` and persists
 * alongside the rest of the folder via the existing yaml / json save
 * codecs. Absent on env folders that were not created from an
 * importable source (manual collections).
 *
 * The refresh flow is fully on-demand: there's no scheduler, no
 * background ticking, no auto-check. The user triggers it from the
 * env-folder home page or the sidebar context menu, and the renderer
 * runs a single checksum-aware fetch — same payload as last time
 * just bumps `lastCheckedAt`; a mismatch (or fetch error) opens the
 * Import modal so the user can re-import (and edit headers / auth /
 * URL there if something needs adjusting).
 */
export interface ApiUpdateConfig {
  /** URL the importer fetches when refreshing the spec. Supports
   * `${VAR}` substitution from the env folder's environments. */
  sourceUrl: string
  /** Optional auth headers, also `${VAR}`-expanded at fetch time.
   * Read-only on the home page — editable only when the Import
   * modal opens (i.e. after a checksum mismatch or a failed
   * Refresh). Empty / omitted by default. */
  sourceHeaders?: Record<string, string>
  /** Epoch ms of the most recent successful import (initial or
   * re-import). Displayed read-only on the home page. */
  lastImportedAt?: number
  /** Epoch ms of the most recent Refresh attempt (success or
   * failure). Displayed read-only on the home page. */
  lastCheckedAt?: number
  /** Structural content hash of the payload that produced the
   * current folder state. The Refresh flow recomputes this on every
   * fetch — equal ⇒ "no update", different ⇒ open the Import modal
   * to let the user diff + apply. */
  payloadChecksum?: string
  /** Reference to an `AuthenticationRequest` inside the same env
   * folder. When set, the refresh flow runs a one-shot auth
   * prefetch against this request before fetching the spec, and
   * merges the resolved headers (e.g. `Authorization: Bearer ...`)
   * into the fetch. Lets a refresh against a protected spec
   * succeed without storing the resolved token statically on disk. */
  authenticationRequestId?: string
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
