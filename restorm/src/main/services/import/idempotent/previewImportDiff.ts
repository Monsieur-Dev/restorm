import type { EnvironmentFolder } from '../../../../shared/types/folderTypes'
import { isAnyFolder, isRequest } from '../../../../shared/types/folderTypes'
import type { Request } from '../../../../shared/types/requests'
import {
  emptyImportDiff,
  type ImportAdapter,
  type ImportDiff,
  type NormalizedOperation,
  type NormalizedSpec
} from './types'

/**
 * Side-effect-free counterpart to `runIdempotentImport`. Computes
 * the same `ImportDiff` it would produce on apply, but without
 * mutating the target tree — useful for the "Refresh from source"
 * confirmation dialog, which needs to surface counters before the
 * user commits.
 *
 * The two functions agree on classification (added / deprecated /
 * removed / merged) so the modal's preview counters match what the
 * apply step will produce. `merged` here is best-effort — without
 * the materialiser hook the pipeline can't know whether a shape
 * mutation would actually have happened, so we count "matched +
 * shape changed" using parameter-name fingerprints, the same proxy
 * the pipeline itself uses internally.
 */

function* collectRequests(folder: EnvironmentFolder): Generator<Request> {
  for (const item of folder.items) {
    if (isAnyFolder(item)) {
      yield* collectRequests(item as EnvironmentFolder)
      continue
    }
    if (isRequest(item)) yield item
  }
}

function paramFingerprint(op: NormalizedOperation): string {
  if ('parameters' in op.shape) {
    const params = (op.shape as { parameters?: { name: string; location: string }[] }).parameters ?? []
    return params.map((p) => `${p.location}:${p.name}`).sort().join('|')
  }
  return ''
}

export function existingRequestFingerprint(request: Request): string {
  // Mirror the param fingerprint used on the pipeline side. Requests
  // store their headers / params on dedicated KeyValue arrays; the
  // pipeline's `mergeRequestShape` reads from `parameters` (path /
  // query / header / body) — we reuse the same set here.
  // The Request model stores path params on `pathParams` and query
  // params on `params` (NOT pathParameters/queryParameters). Reading the
  // wrong names made every fingerprint empty, so the merged-count guard
  // (`opFp && existingFp && …`) never fired and re-import never detected
  // a shape change.
  interface RequestLike {
    pathParams?: { key: string }[]
    params?: { key: string }[]
    headers?: { key: string }[]
  }
  const r = request as unknown as RequestLike
  const all: string[] = []
  for (const p of r.pathParams ?? []) all.push(`path:${p.key}`)
  for (const p of r.params ?? []) all.push(`query:${p.key}`)
  for (const p of r.headers ?? []) all.push(`header:${p.key}`)
  return all.sort().join('|')
}

export function previewImportDiff(
  target: EnvironmentFolder,
  spec: NormalizedSpec,
  adapter: ImportAdapter
): ImportDiff {
  const diff = emptyImportDiff()
  const byOperationId = new Map<string, Request>()
  const byNaturalKey = new Map<string, Request>()
  const fromThisFormat = new Set<Request>()
  for (const r of collectRequests(target)) {
    const origin = r.importOrigin
    if (origin?.format !== adapter.format) continue
    fromThisFormat.add(r)
    if (origin.operationId) byOperationId.set(origin.operationId, r)
    byNaturalKey.set(origin.naturalKey, r)
  }

  const seen = new Set<Request>()
  for (const op of spec.operations) {
    const existing = (op.operationId && byOperationId.get(op.operationId))
      ?? byNaturalKey.get(op.naturalKey)
      ?? null
    if (!existing) {
      diff.added.push(op)
      continue
    }
    seen.add(existing)
    if (op.deprecated && existing.deprecated !== true) diff.deprecated.push(op)
    const opFp = paramFingerprint(op)
    const existingFp = existingRequestFingerprint(existing)
    if (opFp && existingFp && opFp !== existingFp) diff.merged.push(op)
  }

  for (const r of fromThisFormat) {
    if (seen.has(r)) continue
    if (r.removed === true) continue
    // Skip authentication routes the import wizard attached even
    // when they accidentally end up under the same `format` slot
    // — they're never part of the API surface the spec describes,
    // so their absence from the spec must NOT count as "removed".
    const reqType = (r as { type?: string }).type
    if (reqType === 'auth') continue
    diff.removed.push({
      operationId: r.importOrigin?.operationId,
      naturalKey: r.importOrigin?.naturalKey ?? r.name,
      name: r.name,
      deprecated: r.deprecated === true,
      shape: { protocol: 'http', method: '', url: '', parameters: [] }
    })
  }

  diff.modelsAdded.push(...spec.models.filter((m) => !m.deprecated))
  diff.modelsDeprecated.push(...spec.models.filter((m) => m.deprecated))
  diff.enumsAdded.push(...spec.enums.filter((e) => !e.deprecated))
  diff.enumsDeprecated.push(...spec.enums.filter((e) => e.deprecated))

  return diff
}
