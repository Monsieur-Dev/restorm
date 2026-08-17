/**
 * Walk the workspace tree and return the set of request ids whose
 * URL currently resolves to a `deprecated: true` operation in the
 * owning env folder's apiDocumentation. Drives the sidebar's
 * dimming of deprecated routes.
 *
 * Live: re-evaluates on every change to `rootItems` (which the
 * renderer bumps via `updateCount` when an in-place mutation
 * happens). Editing a request's URL therefore makes the row dim or
 * un-dim instantly — no persisted `request.deprecated` flag
 * involved, the decision rides on the matcher's regex output.
 */
import { useMemo } from 'react'
import type { EnvironmentFolder, FolderItem, Request } from '../../../shared/types/collections'
import { isAnyFolder, isEnvironmentFolder, isRequest } from '../../../shared/types/collections'
import type { ApiDocumentation } from '../../../shared/types/apiDocumentation'
import { findOperationForRoute, type RouteLike } from '../../../shared/utils/findOperationForRoute'
import { resolveUrlAgainstEnv, flattenEnvVars, coerceEnvVarValue } from '../../../shared/utils/resolveUrlAgainstEnv'

function envVarsFromFolder(folder: EnvironmentFolder): Record<string, string> {
  const env = folder.environments[0]
  if (!env) return {}
  const out: Record<string, string> = {}
  for (const kv of env.variables) {
    const coerced = coerceEnvVarValue(kv.value)
    if (coerced !== undefined) out[kv.key] = coerced
  }
  return out
}

function routeFromRequest(request: Request): RouteLike | null {
  const r = request as unknown as Record<string, unknown>
  const tags = Array.isArray(r['tags']) ? (r['tags'] as string[]) : undefined
  const str = (key: string): string | undefined => {
    const v = r[key]
    return typeof v === 'string' ? v : undefined
  }
  switch (r['type']) {
    case 'http':
    case 'auth': {
      const route: RouteLike = { type: 'http' }
      if (tags !== undefined) route.tags = tags
      const url = str('url'); if (url !== undefined) route.url = url
      const method = str('method'); if (method !== undefined) route.method = method
      return route
    }
    case 'graphql': {
      const route: RouteLike = { type: 'graphql' }
      if (tags !== undefined) route.tags = tags
      const url = str('url'); if (url !== undefined) route.url = url
      const operationType = str('operationType'); if (operationType !== undefined) route.operationType = operationType
      const query = str('query'); if (query !== undefined) route.query = query
      return route
    }
    case 'grpc': {
      const route: RouteLike = { type: 'grpc' }
      if (tags !== undefined) route.tags = tags
      const service = str('service'); if (service !== undefined) route.service = service
      const method = str('method'); if (method !== undefined) route.rpcMethod = method
      return route
    }
    case 'soap': {
      const route: RouteLike = { type: 'soap' }
      if (tags !== undefined) route.tags = tags
      const url = str('url'); if (url !== undefined) route.url = url
      const soapAction = str('soapAction'); if (soapAction !== undefined) route.soapAction = soapAction
      const operation = str('operation'); if (operation !== undefined) route.operation = operation
      const service = str('service'); if (service !== undefined) route.service = service
      return route
    }
    case 'websocket': {
      const route: RouteLike = { type: 'websocket' }
      if (tags !== undefined) route.tags = tags
      const url = str('url'); if (url !== undefined) route.url = url
      const protocol = str('protocol'); if (protocol !== undefined) route.protocol = protocol
      const event = str('event'); if (event !== undefined) route.event = event
      return route
    }
    default:
      return null
  }
}

/**
 * @param rootItems the workspace tree (env folders, folders, top-level requests)
 * @param updateCount bump-on-mutation counter so the memo recomputes
 *   when reactive proxies change in place (URL edits, etc.) without
 *   the parent array reference flipping.
 */
export function useDeprecatedRequestIds(
  rootItems: readonly FolderItem[],
  updateCount = 0
): Set<string> {
  return useMemo(() => {
    void updateCount
    const out = new Set<string>()
    function walk(items: readonly FolderItem[], envFolder: EnvironmentFolder | null, envVars: Record<string, string>): void {
      for (const item of items) {
        if (isAnyFolder(item)) {
          if (isEnvironmentFolder(item)) {
            const next = flattenEnvVars(envVarsFromFolder(item))
            walk(item.items, item, next)
          } else {
            walk(item.items, envFolder, envVars)
          }
          continue
        }
        if (!isRequest(item)) continue
        if (!envFolder) continue
        // `apiDocumentation` lives on the env-folder model class but
        // not on the shared `EnvironmentFolder` interface (the type
        // is intentionally lighter than the runtime class). Read it
        // through a typed view to keep TS happy without `any`.
        const apiDoc = (envFolder as unknown as { apiDocumentation?: ApiDocumentation }).apiDocumentation
        if (!apiDoc) continue
        const route = routeFromRequest(item)
        if (!route) continue
        if (route.url !== undefined) {
          route.url = resolveUrlAgainstEnv(route.url, envVars)
        }
        const op = findOperationForRoute(apiDoc, route)
        if (op?.deprecated === true) out.add(item.id)
      }
    }
    for (const item of rootItems) {
      if (isEnvironmentFolder(item)) {
        const envVars = flattenEnvVars(envVarsFromFolder(item))
        walk(item.items, item, envVars)
      } else if (isAnyFolder(item)) {
        walk(item.items, null, {})
      }
    }
    return out
  }, [rootItems, updateCount])
}
