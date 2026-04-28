import type { ApiDocumentation, OperationMatchCriteria } from '../../../shared/types/apiDocumentation'

/**
 * Format-agnostic comparison of two `ApiDocumentation` instances —
 * the shape every importer (Swagger, OpenAPI 3, GraphQL, Postman,
 * etc.) already produces. Used by the refresh wizard so the
 * "what changed in the spec since last refresh" view is uniform
 * across formats and doesn't require any per-format adapter.
 *
 * The diff is keyed by `operationKeyForMatch` — a deterministic
 * string built from the operation's match criteria. The same
 * function is used by the wizard tree to map each rendered leaf
 * back to its operation status.
 */

export type DocOperationStatus = 'unchanged' | 'added' | 'modified' | 'removed'

export interface CompareApiDocumentationsResult {
  byOperationKey: Map<string, DocOperationStatus>
  counts: Record<DocOperationStatus, number>
  /** Set of `model:<name>` and `enum:<name>` keys touched in the
   * new doc — surfaces a "X model(s) changed" counter on the
   * summary line without forcing the wizard to walk the model
   * graph itself. */
  modelsTouched: number
}

/**
 * Build the canonical operation key from match criteria. Same key
 * shape across formats so the diff resolver, the wizard tree, and
 * the import-selection snapshot all share one identifier.
 *
 * Format-specific shapes:
 *
 * - **HTTP / OData**: `${METHOD} ${urlPattern}` (e.g. `GET /pets/{id}`).
 * - **GraphQL**: `${operationType} ${operationName}` (e.g.
 *   `query getPet`).
 * - **gRPC**: `${serviceName}/${operationName}` (e.g. `PetService/getPet`).
 * - **SOAP**: `soap:${soapAction ?? operationName}`.
 * - **AsyncAPI / WebSocket**: `${direction} ${event}` (e.g.
 *   `subscribe pet/created`).
 *
 * Anything else falls back to the operation name, then the empty
 * string. The fallback is intentional — the resolver is best-effort
 * and would rather treat two unrelated entries as "unchanged" than
 * crash on a partially-populated match record.
 */
export function operationKeyForMatch(match: OperationMatchCriteria): string {
  if (match.operationType && match.operationName) {
    return `${match.operationType} ${match.operationName}`
  }
  if (match.serviceName && match.operationName) {
    return `${match.serviceName}/${match.operationName}`
  }
  if (match.soapAction) {
    return `soap:${match.soapAction}`
  }
  if (match.direction && match.event) {
    return `${match.direction} ${match.event}`
  }
  if (match.method && match.urlPattern) {
    return `${match.method.toUpperCase()} ${match.urlPattern}`
  }
  if (match.urlPattern) {
    return match.urlPattern
  }
  return match.operationName ?? ''
}

function structuralFingerprintFor(op: { match?: OperationMatchCriteria; parameters?: unknown; responses?: unknown; deprecated?: boolean; consumes?: string[]; produces?: string[] }): string {
  // Fingerprint covers the parts of the operation a refresh would
  // surface as "modified" — params, response shapes, deprecation,
  // content-type negotiation. Doc descriptions / summaries are
  // intentionally excluded so an editorial-only spec change doesn't
  // surface as a modification.
  return JSON.stringify({
    p: op.parameters ?? null,
    r: op.responses ?? null,
    d: op.deprecated === true,
    c: op.consumes ?? null,
    pr: op.produces ?? null
  })
}

export function compareApiDocumentations(
  oldDoc: ApiDocumentation | undefined,
  newDoc: ApiDocumentation
): CompareApiDocumentationsResult {
  const byOperationKey = new Map<string, DocOperationStatus>()
  const counts: Record<DocOperationStatus, number> = {
    unchanged: 0,
    added: 0,
    modified: 0,
    removed: 0
  }

  const oldByKey = new Map<string, ReturnType<typeof structuralFingerprintFor>>()
  const oldOps = oldDoc?.operations ?? []
  for (const op of oldOps) oldByKey.set(operationKeyForMatch(op.match), structuralFingerprintFor(op))

  const seenKeys = new Set<string>()
  for (const op of newDoc.operations) {
    const key = operationKeyForMatch(op.match)
    if (!key) continue
    seenKeys.add(key)
    const oldFingerprint = oldByKey.get(key)
    if (oldFingerprint === undefined) {
      byOperationKey.set(key, 'added')
      counts.added += 1
      continue
    }
    const newFingerprint = structuralFingerprintFor(op)
    if (oldFingerprint === newFingerprint) {
      byOperationKey.set(key, 'unchanged')
      counts.unchanged += 1
      continue
    }
    byOperationKey.set(key, 'modified')
    counts.modified += 1
  }

  for (const op of oldOps) {
    const key = operationKeyForMatch(op.match)
    if (!key) continue
    if (seenKeys.has(key)) continue
    byOperationKey.set(key, 'removed')
    counts.removed += 1
  }

  // Models / enums "touched" — anything whose JSON serialisation
  // differs between old + new (or appears only in new). Used for
  // the lightweight "X model(s) changed" counter on the summary
  // line; not surfaced as per-row status because the wizard tree
  // doesn't render models.
  let modelsTouched = 0
  const oldModels = oldDoc?.models ?? {}
  const newModels = newDoc.models
  const allModelNames = new Set([...Object.keys(oldModels), ...Object.keys(newModels)])
  for (const name of allModelNames) {
    if (JSON.stringify(oldModels[name] ?? null) !== JSON.stringify(newModels[name] ?? null)) {
      modelsTouched += 1
    }
  }

  return { byOperationKey, counts, modelsTouched }
}
