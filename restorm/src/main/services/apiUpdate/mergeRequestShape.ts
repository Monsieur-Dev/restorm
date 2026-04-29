import type { Request } from '../../../shared/types/requests'
import type { NormalizedOperation, NormalizedParameter } from '../import/idempotent/types'

/**
 * Conservative-merge hook for `runIdempotentImport`. Applies the
 * specific rules from the ticket (§3, "Merge rule on existing
 * requests"):
 *
 * - Params / headers / body fields **added** in the spec → appended
 *   to the request with empty values.
 * - Params **removed** from the spec → kept on the request (the user
 *   may still want to call them).
 * - User edits on existing params → preserved verbatim. The merge
 *   never overwrites a `key`, `value`, `description`, or
 *   `enabled` field that already exists.
 * - Request `name` → never updated.
 * - HTTP method / URL → never updated either.
 *
 * The hook only touches HTTP-shaped requests today; GraphQL /
 * gRPC / SOAP / OData go through their own path (their requests
 * carry no `params` / `headers` / `pathParams` arrays — the body
 * IS the operation contract).
 */
interface HttpRequestLike {
  type?: string
  headers?: { id?: string; key: string; value?: unknown; enabled?: boolean }[]
  params?: { id?: string; key: string; value?: unknown; enabled?: boolean }[]
  pathParams?: { id?: string; key: string; value?: unknown; enabled?: boolean }[]
}

function bucketFor(location: string): 'headers' | 'params' | 'pathParams' | null {
  if (location === 'header') return 'headers'
  if (location === 'query') return 'params'
  if (location === 'path') return 'pathParams'
  return null
}

export function mergeHttpRequestShape(existing: Request, op: NormalizedOperation): void {
  const r = existing as unknown as HttpRequestLike
  if (r.type !== 'http' && r.type !== 'auth') return
  if (!('parameters' in op.shape)) return
  const params = (op.shape as { parameters: NormalizedParameter[] }).parameters

  // Group spec parameters by HTTP location and merge each bucket
  // independently. Body / formData parameters are skipped: the
  // body editor consumes the schema separately, and adding them
  // here would surface as duplicate KV rows.
  const grouped: Record<'headers' | 'params' | 'pathParams', NormalizedParameter[]> = {
    headers: [],
    params: [],
    pathParams: []
  }
  for (const p of params) {
    const bucket = bucketFor(p.location)
    if (bucket) grouped[bucket].push(p)
  }

  for (const bucket of ['headers', 'params', 'pathParams'] as const) {
    const target = r[bucket] ?? []
    if (!r[bucket]) (r as unknown as Record<string, unknown[]>)[bucket] = target
    const existingNames = new Set(target.map((p) => p.key))
    for (const specParam of grouped[bucket]) {
      if (existingNames.has(specParam.name)) continue
      target.push({
        key: specParam.name,
        value: specParam.defaultValue ?? '',
        ...(specParam.description !== undefined ? { description: specParam.description } : {}),
        enabled: true
      })
    }
  }
}
