import type { ImportSourceType } from '../../../../shared/types/baseTypes'

/**
 * Common normalised shape every importer produces. The idempotent
 * pipeline (`runIdempotentImport`) operates on this representation
 * — the per-format adapter's only job is to translate a raw spec
 * into a `NormalizedSpec`. Adding a new import format becomes a
 * one-file change once the pipeline is in place.
 *
 * Three consumer pieces use this shape:
 *
 * - The initial-import path materialises every entry into the
 *   target env folder.
 * - The refresh path diffs against the existing folder content
 *   indexed by `importOrigin`, marks vanished operations / models /
 *   enums as `removed`, surfaces newly deprecated ones, and merges
 *   shape changes conservatively.
 * - The future "diff preview" wizard reads two `NormalizedSpec`
 *   snapshots and decides what to apply per-element.
 */
export interface NormalizedSpec {
  /** `info.version` (or equivalent) when the source provides one. */
  version?: string
  operations: NormalizedOperation[]
  models: NormalizedModel[]
  enums: NormalizedEnum[]
  /** Initial-import-only — the refresh path leaves environments alone. */
  environments: NormalizedEnvironment[]
}

/**
 * One operation (HTTP route, GraphQL field, gRPC method, …) in the
 * normalised shape. The pipeline matches operations across re-imports
 * by `operationId` first (the spec author's stable id) and falls
 * back to `naturalKey` when no `operationId` is available — both are
 * captured up-front so a rename of either side doesn't lose the
 * link.
 */
export interface NormalizedOperation {
  operationId?: string
  /**
   * Deterministic identity derived from the operation's intrinsic
   * shape (e.g. `GET /pets/{id}` for HTTP, `query.getPet` for
   * GraphQL). Stable across imports of the same source.
   */
  naturalKey: string
  /** Display name surfaced in the sidebar. The pipeline never
   * overwrites the user's edit of this on a refresh. */
  name: string
  /** `true` when the spec marks the op deprecated. The pipeline
   * mirrors this onto the local request and never un-deprecates
   * something the spec still calls deprecated. */
  deprecated: boolean
  /** Format-specific data the importer captures for materialisation
   * — method/path/params/body/response schemas for HTTP, etc. */
  shape: OperationShape
}

/**
 * Format-agnostic operation payload. Initially keyed by `protocol`
 * so the pipeline can decide which materialisation strategy to use;
 * extensible without touching the pipeline interface itself.
 */
export type OperationShape =
  | HttpOperationShape
  | GraphqlOperationShape
  | GenericOperationShape

export interface HttpOperationShape {
  protocol: 'http'
  method: string
  url: string
  /** Documented params, including their location (path / query /
   * header / body / formData). The pipeline uses the location +
   * name as the merge key when reconciling against an existing
   * request's customised params. */
  parameters: NormalizedParameter[]
  /** Optional JSON-shaped request body schema (Swagger body, etc.).
   * Consumed by the materialiser to populate the body editor's
   * default. */
  bodySchema?: unknown
  responses?: Record<string, NormalizedResponse>
}

export interface GraphqlOperationShape {
  protocol: 'graphql'
  operationType: 'query' | 'mutation' | 'subscription'
  fieldName: string
  /** Generated query/mutation/subscription text the materialiser
   * drops into the GraphQL request's body. */
  document: string
  variables?: NormalizedParameter[]
}

export interface GenericOperationShape {
  protocol: 'soap' | 'grpc' | 'asyncapi' | 'odata' | 'postman' | 'insomnia' | 'bruno' | 'curl' | 'powershell' | 'url'
  /** Format-specific raw payload. The pipeline doesn't introspect
   * it — only the materialiser does. Idempotent merge for these
   * protocols is "additive only" (new ops added, missing ops
   * marked removed); shape merging is delegated to the
   * materialiser. */
  raw: unknown
}

export interface NormalizedParameter {
  name: string
  /** `'path' | 'query' | 'header' | 'body' | 'formData' |
   * 'variable' | 'argument'` etc. — kept as a string so the
   * pipeline doesn't have to know every protocol's vocabulary. */
  location: string
  type?: string
  required?: boolean
  description?: string
  /** Optional default value the importer surfaces to the user. */
  defaultValue?: string
}

export interface NormalizedResponse {
  description?: string
  schema?: unknown
}

export interface NormalizedModel {
  name: string
  description?: string
  deprecated: boolean
  properties: NormalizedProperty[]
}

export interface NormalizedProperty {
  name: string
  type: string
  required: boolean
  description?: string
  deprecated: boolean
}

export interface NormalizedEnum {
  name: string
  values: string[]
  deprecated: boolean
}

export interface NormalizedEnvironment {
  name: string
  variables: { key: string; value: string }[]
}

/**
 * Per-format adapter the pipeline consumes. Implementations read a
 * raw parsed spec (the importer's input) and produce a
 * `NormalizedSpec`. Side-effect-free — every materialisation
 * decision lives in the shared pipeline so the idempotency
 * guarantees are uniform.
 */
export interface ImportAdapter {
  format: ImportSourceType
  extractNormalizedSpec(rawSpec: unknown, options: AdapterOptions): NormalizedSpec
}

export interface AdapterOptions {
  /** Used by the HTTP adapters that carve env-folder URLs into a
   * `{{baseUrl}}` placeholder. Most adapters can ignore. */
  baseUrlVariableName?: string
  /** Per-importer hook for source-specific options (auth headers,
   * include/exclude filters, etc.). The pipeline doesn't read this. */
  extra?: Record<string, unknown>
}

/**
 * Per-call summary of what the pipeline changed. Initial imports
 * surface every entry under `added`; idempotent re-imports on an
 * unchanged spec produce an empty diff (the pinned invariant). The
 * confirmation modal reads counters off this struct, and the BDD
 * tests assert it directly.
 */
export interface ImportDiff {
  added: NormalizedOperation[]
  deprecated: NormalizedOperation[]
  removed: NormalizedOperation[]
  /** Ops the pipeline merged shape changes onto an existing
   * request (new params appended, etc. — see Q3a in the ticket). */
  merged: NormalizedOperation[]
  modelsAdded: NormalizedModel[]
  modelsDeprecated: NormalizedModel[]
  modelsRemoved: NormalizedModel[]
  enumsAdded: NormalizedEnum[]
  enumsDeprecated: NormalizedEnum[]
  enumsRemoved: NormalizedEnum[]
}

export function emptyImportDiff(): ImportDiff {
  return {
    added: [],
    deprecated: [],
    removed: [],
    merged: [],
    modelsAdded: [],
    modelsDeprecated: [],
    modelsRemoved: [],
    enumsAdded: [],
    enumsDeprecated: [],
    enumsRemoved: []
  }
}

/**
 * Convenience predicate the pipeline + tests share — `true` iff the
 * diff records no changes at all. Pinned by the
 * "re-importing the same spec is a no-op" invariant.
 */
export function isImportDiffEmpty(diff: ImportDiff): boolean {
  return (
    diff.added.length === 0 &&
    diff.deprecated.length === 0 &&
    diff.removed.length === 0 &&
    diff.merged.length === 0 &&
    diff.modelsAdded.length === 0 &&
    diff.modelsDeprecated.length === 0 &&
    diff.modelsRemoved.length === 0 &&
    diff.enumsAdded.length === 0 &&
    diff.enumsDeprecated.length === 0 &&
    diff.enumsRemoved.length === 0
  )
}
