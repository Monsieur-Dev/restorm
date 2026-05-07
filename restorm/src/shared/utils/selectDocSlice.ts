/**
 * Pure helper that scopes an `ApiDocumentation` to a subset of
 * operations + the transitive closure of models they reference,
 * deduplicated. Used by `DocumentationHost` (renderer) to render
 * the env-folder, folder, and route scopes off a single root spec.
 *
 * No React imports — fully unit-testable in isolation.
 */
import type {
  ApiDocumentation,
  GroupDocumentation,
  ModelDocumentation,
  OperationDocumentation
} from '../types/apiDocumentation'
import { findOperationForRoute, type RouteLike } from './findOperationForRoute'

export interface DocSlice {
  /** Operations in scope, in spec-declared order. */
  operations: OperationDocumentation[]
  /** Transitive closure of models referenced by `operations`,
   * deduplicated. Empty when no model is touched. */
  models: ModelDocumentation[]
  /** Groups whose operations are in scope (sidebar fodder).
   * Groups with no in-scope operation are omitted. */
  groups: GroupDocumentation[]
  /** The root API info block, always carried through unchanged so
   * the host can render the scope header without a second arg. */
  api: ApiDocumentation['api']
}

/**
 * Resolve a list of route filters against the documentation. When
 * `filters` is undefined or empty, every operation + every model is
 * returned (the "browse the whole API" case used by the env-folder
 * scope). Otherwise:
 *
 * - operations: every operation that matches one of the filters via
 *   `findOperationForRoute` — deduped (same op selected by two
 *   filters won't appear twice).
 * - models: BFS starting from each in-scope operation's
 *   `referencedModels`, following each property's `targetModelRef`
 *   to grow the closure. Dangling refs (model name absent from
 *   `apiDoc.models`) are skipped.
 * - groups: every group whose name matches an in-scope operation's
 *   `group`, in the order they were declared on the root.
 */
export function selectDocSlice(
  apiDoc: ApiDocumentation,
  filters: RouteLike[] | undefined
): DocSlice {
  const operations = filterOperations(apiDoc, filters)
  const models = transitiveModelClosure(apiDoc, operations, filters)
  const inScopeGroupNames = new Set<string>()
  for (const op of operations) {
    if (op.group !== undefined && op.group.length > 0) inScopeGroupNames.add(op.group)
  }
  const groups: GroupDocumentation[] = []
  for (const groupName of Object.keys(apiDoc.groups)) {
    if (!inScopeGroupNames.has(groupName)) continue
    const g = apiDoc.groups[groupName]
    if (g) groups.push(g)
  }
  return { operations, models, groups, api: apiDoc.api }
}

function filterOperations(
  apiDoc: ApiDocumentation,
  filters: RouteLike[] | undefined
): OperationDocumentation[] {
  if (!filters || filters.length === 0) return apiDoc.operations
  const matched = new Set<OperationDocumentation>()
  for (const filter of filters) {
    const op = findOperationForRoute(apiDoc, filter)
    if (op) matched.add(op)
  }
  return Array.from(matched)
}

/**
 * Walk every filtered operation's `referencedModels` plus every
 * property's `targetModelRef` to produce the deduplicated transitive
 * closure of models the filtered routes consume. Without filters,
 * returns every model declared in the spec.
 */
function transitiveModelClosure(
  apiDoc: ApiDocumentation,
  operations: OperationDocumentation[],
  filters: RouteLike[] | undefined
): ModelDocumentation[] {
  if (!filters || filters.length === 0) return Object.values(apiDoc.models)
  const visited = new Set<string>()
  const queue: string[] = []
  for (const op of operations) {
    if (op.referencedModels) {
      for (const name of op.referencedModels) queue.push(name)
    }
  }
  while (queue.length > 0) {
    const name = queue.shift()
    if (name === undefined || visited.has(name)) continue
    visited.add(name)
    const model = apiDoc.models[name]
    if (!model) continue
    for (const prop of model.properties) {
      if (prop.targetModelRef !== undefined && !visited.has(prop.targetModelRef)) {
        queue.push(prop.targetModelRef)
      }
    }
    // Also follow oneOf / anyOf / discriminator-mapping cross-edges
    // so polymorphic siblings travel together with the parent.
    if (model.composition) {
      for (const ref of model.composition.oneOf ?? []) if (!visited.has(ref)) queue.push(ref)
      for (const ref of model.composition.anyOf ?? []) if (!visited.has(ref)) queue.push(ref)
      const mapping = model.composition.discriminator?.mapping
      if (mapping) {
        for (const target of Object.values(mapping)) {
          if (!visited.has(target)) queue.push(target)
        }
      }
    }
  }
  const closure: ModelDocumentation[] = []
  for (const name of visited) {
    const m = apiDoc.models[name]
    if (m) closure.push(m)
  }
  return closure
}
