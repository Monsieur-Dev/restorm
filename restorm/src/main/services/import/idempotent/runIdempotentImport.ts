import type { EnvironmentFolder, FolderItem } from '../../../../shared/types/folderTypes'
import { isAnyFolder, isRequest } from '../../../../shared/types/folderTypes'
import type { Request, ImportOrigin } from '../../../../shared/types/requests'
import { isHTTPRequest, isAuthenticationRequest } from '../../../../shared/types/requests'
import {
  emptyImportDiff,
  type ImportAdapter,
  type ImportDiff,
  type NormalizedOperation,
  type NormalizedSpec
} from './types'

/**
 * Format-agnostic idempotent import / refresh pipeline.
 *
 * Same code path runs for "import into an empty folder" and
 * "re-import into a populated folder". Calling it twice with the
 * same spec produces an empty diff — the pinned invariant the test
 * suite hammers on.
 *
 * Guarantees:
 *
 * - **Idempotent.** Two runs with the same spec produce identical
 *   results; the second yields `isImportDiffEmpty(diff)`.
 * - **Non-destructive.** Never deletes an existing request. Operations
 *   missing from the new spec are flipped to `removed: true` (the user
 *   keeps the request and can still execute it). Operations the user
 *   created manually (no `importOrigin`) are not touched at all.
 * - **Conservative shape merge.** New params / headers / body fields
 *   in the spec are appended to the existing request with empty values;
 *   removed params are kept (the user may still need them); user
 *   edits on existing params are preserved; the request name is never
 *   overwritten. Deprecation flags propagate from spec to request.
 *
 * Returns the diff so the caller can show counters in the
 * confirmation modal and surface a "X changes applied" toast.
 */
export interface RunIdempotentImportOptions {
  target: EnvironmentFolder
  spec: NormalizedSpec
  adapter: ImportAdapter
  /**
   * Hook invoked when the pipeline needs to materialise a brand-new
   * request for an operation. Implementations are format-specific
   * (HTTPRequest factory for Swagger, GraphQLRequest for GraphQL,
   * etc.) so the pipeline doesn't have to know every shape — they
   * only need to honour the `importOrigin` argument so future
   * refreshes can match the request back to its source operation.
   */
  createRequest: (op: NormalizedOperation, origin: ImportOrigin) => Request
  /**
   * Hook invoked when the pipeline detects an existing request whose
   * source operation has changed shape. Implementations apply the
   * conservative-merge rules — the pipeline only tells them WHICH
   * operation changed and supplies the existing request to mutate.
   */
  mergeRequestShape?: (existing: Request, op: NormalizedOperation) => void
  /**
   * Hook invoked when the pipeline needs to attach a freshly created
   * request to the target tree. Defaults to appending to
   * `target.items` (env-folder root). The apply path supplies an
   * implementation that mirrors the request's position in the
   * freshly-imported folder, so additions land inside the same tag /
   * group folder a fresh import would have produced rather than at
   * the env-folder root.
   */
  placeRequest?: (target: EnvironmentFolder, request: Request, op: NormalizedOperation) => void
}

/**
 * Walk an env folder and yield every leaf request, regardless of
 * how deep the folder structure goes. Implemented as a generator so
 * the pipeline can short-circuit without materialising a giant array
 * for huge specs.
 */
export function* collectRequests(folder: FolderItem | EnvironmentFolder): Generator<Request> {
  if (isAnyFolder(folder)) {
    for (const item of folder.items) yield* collectRequests(item)
    return
  }
  if (isRequest(folder)) yield folder
}

/**
 * Index requests by their `importOrigin`'s `operationId` and
 * `naturalKey`. Built once per pipeline run so the per-operation
 * lookup stays O(1).
 */
function indexRequestsByOrigin(
  folder: EnvironmentFolder,
  format: ImportAdapter['format']
): {
  byOperationId: Map<string, Request>
  byNaturalKey: Map<string, Request>
  fromThisFormat: Set<Request>
} {
  const byOperationId = new Map<string, Request>()
  const byNaturalKey = new Map<string, Request>()
  const fromThisFormat = new Set<Request>()
  for (const r of collectRequests(folder)) {
    const origin = r.importOrigin
    if (origin?.format !== format) continue
    fromThisFormat.add(r)
    if (origin.operationId) byOperationId.set(origin.operationId, r)
    byNaturalKey.set(origin.naturalKey, r)
  }
  return { byOperationId, byNaturalKey, fromThisFormat }
}

function matchExistingRequest(
  op: NormalizedOperation,
  index: ReturnType<typeof indexRequestsByOrigin>
): Request | null {
  if (op.operationId) {
    const byId = index.byOperationId.get(op.operationId)
    if (byId) return byId
  }
  return index.byNaturalKey.get(op.naturalKey) ?? null
}

/**
 * Default placement: append directly under the env-folder root.
 * Callers that want grouping (tag folders, GraphQL operation-type
 * folders, …) supply their own `placeRequest` hook.
 */
function defaultPlaceRequest(target: EnvironmentFolder, req: Request): void {
  target.items.push(req)
}

export function runIdempotentImport(options: RunIdempotentImportOptions): ImportDiff {
  const { target, spec, adapter, createRequest, mergeRequestShape, placeRequest } = options
  const diff = emptyImportDiff()
  const index = indexRequestsByOrigin(target, adapter.format)
  const seenInThisRun = new Set<Request>()
  const place = placeRequest ?? defaultPlaceRequest

  for (const op of spec.operations) {
    const existing = matchExistingRequest(op, index)
    if (!existing) {
      const origin: ImportOrigin = op.operationId !== undefined
        ? { format: adapter.format, operationId: op.operationId, naturalKey: op.naturalKey }
        : { format: adapter.format, naturalKey: op.naturalKey }
      const created = createRequest(op, origin)
      place(target, created, op)
      diff.added.push(op)
      continue
    }

    seenInThisRun.add(existing)

    let mergedThisRun = false

    // Op reappears in the spec after being marked removed → clear
    // the flag. Counts as a "merge" for diff-summary purposes so
    // the user sees that something changed.
    if (existing.removed === true) {
      existing.removed = false
      mergedThisRun = true
    }

    // Spec-level deprecation propagates to the request. Once
    // deprecated, never silently un-deprecates — the spec author
    // typically keeps deprecation forever. (If a future spec drops
    // the `deprecated: true` flag, we leave the request marked.)
    if (op.deprecated && existing.deprecated !== true) {
      existing.deprecated = true
      diff.deprecated.push(op)
      mergedThisRun = true
    }

    // Conservative shape merge — delegate to the materialiser hook
    // so the pipeline doesn't have to know every protocol's body /
    // param schema. The hook is expected to mutate `existing` in
    // place.
    if (mergeRequestShape) {
      const beforeNames = snapshotMergeFingerprint(existing)
      mergeRequestShape(existing, op)
      const afterNames = snapshotMergeFingerprint(existing)
      if (beforeNames !== afterNames) {
        mergedThisRun = true
      }
    }

    if (mergedThisRun) diff.merged.push(op)
  }

  // Operations that vanished from the spec — flip removed=true on
  // any spec-imported request that wasn't seen in this run.
  // Authentication routes prepended by the import wizard share the
  // same env folder but carry no API operation; never mark them
  // removed, regardless of `importOrigin.format`.
  for (const r of index.fromThisFormat) {
    if (seenInThisRun.has(r)) continue
    if (r.removed === true) continue
    if ((r as { type?: string }).type === 'auth') continue
    r.removed = true
    diff.removed.push({
      operationId: r.importOrigin?.operationId,
      naturalKey: r.importOrigin?.naturalKey ?? r.name,
      name: r.name,
      deprecated: r.deprecated === true,
      shape: { protocol: 'http', method: '', url: '', parameters: [] }
    })
  }

  // Models — same shape as operations, but no per-model
  // materialisation in v1 (the model definitions live on
  // `EnvironmentFolder.apiDocumentation`, not on individual
  // requests). We still tally what changed for the confirmation
  // modal counters.
  diff.modelsAdded.push(...spec.models.filter((m) => !m.deprecated))
  diff.modelsDeprecated.push(...spec.models.filter((m) => m.deprecated))
  diff.enumsAdded.push(...spec.enums.filter((e) => !e.deprecated))
  diff.enumsDeprecated.push(...spec.enums.filter((e) => e.deprecated))
  // (Removed models / enums are populated by the upstream
  // documentation merge, not the pipeline — `apiDocumentation` is
  // recomputed from the parsed spec on every refresh.)

  return diff
}

/**
 * Cheap fingerprint of the parts of a request that the
 * conservative-merge hook is allowed to touch. The pipeline uses
 * the before/after pair to decide whether to count the op under
 * `diff.merged`. Implementations of `mergeRequestShape` must keep
 * this fingerprint stable when the spec didn't actually introduce
 * a change — otherwise refreshes that should be no-ops would log
 * spurious merges in the diff.
 */
function snapshotMergeFingerprint(req: Request): string {
  if (isHTTPRequest(req) || isAuthenticationRequest(req)) {
    const params = req.params
    const headers = req.headers
    const pathParams = req.pathParams
    return [
      req.method,
      req.url,
      params.map((p) => `${p.key}=${stringifyValue(p.value)}`).join('|'),
      headers.map((p) => `${p.key}=${stringifyValue(p.value)}`).join('|'),
      pathParams.map((p) => `${p.key}=${stringifyValue(p.value)}`).join('|')
    ].join('||')
  }
  // Generic fallback — read whatever string-valued fields the
  // request happens to expose. Good enough for fingerprinting; the
  // pipeline only compares the result against itself.
  return JSON.stringify(req, (_, v: unknown) => (typeof v === 'function' ? undefined : v))
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') {
    try {
      // `JSON.stringify` throws on circular refs in our setup; fall
      // back to a fixed token so the fingerprint stays stable (the
      // pipeline only compares snapshots against each other).
      return JSON.stringify(value)
    } catch {
      return '[object]'
    }
  }
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  return ''
}
