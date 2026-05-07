/**
 * useApiDocumentationFromRequest — exposes the structured
 * `ApiDocumentation` of the request's owning EnvironmentFolder, plus
 * the env-resolved route the request maps to. Feeds the structured
 * documentation viewer (`DocumentationHost`) which consumes the raw
 * object tree directly.
 *
 * Pure renderer-side: no IPC round-trip.
 */

import { useMemo } from 'react'
import { useRestormStore } from '../store/restormStore'
import type { Request } from '../../../shared/types/collections'
import type { ApiDocumentation } from '../../../shared/types/apiDocumentation'
import type { RouteLike } from '../../../shared/utils/findOperationForRoute'
import { resolveUrlAgainstEnv, flattenEnvVars } from '../../../shared/utils/resolveUrlAgainstEnv'
import type { EnvironmentFolder } from '../../../shared/types/folderTypes'
import { routeFromRequest } from './routeFromRequest'

function apiDocFromItem(item: unknown): ApiDocumentation | undefined {
  if (item && typeof item === 'object' && 'apiDocumentation' in item) {
    const raw = (item as { apiDocumentation?: unknown }).apiDocumentation
    return raw as ApiDocumentation | undefined
  }
  return undefined
}

function envVarsFromFolder(folder: EnvironmentFolder | null): Record<string, string> {
  if (!folder) return {}
  const env = folder.environments[0]
  if (!env) return {}
  const out: Record<string, string> = {}
  for (const kv of env.variables) {
    const v: unknown = kv.value
    if (typeof v === 'string') out[kv.key] = v
    else if (typeof v === 'number' || typeof v === 'boolean') out[kv.key] = String(v)
    else if (v && typeof v === 'object') {
      const obj = v as { value?: unknown; toString?: () => string }
      if (typeof obj.value === 'string') out[kv.key] = obj.value
      else if (typeof obj.value === 'number' || typeof obj.value === 'boolean') out[kv.key] = String(obj.value)
      else if (typeof obj.toString === 'function' && obj.toString !== Object.prototype.toString) {
        const s = obj.toString()
        if (s !== '[object Object]') out[kv.key] = s
      }
    }
  }
  return out
}

export interface ApiDocumentationFromRequest {
  /** The structured ApiDocumentation owned by the request's parent
   * env folder, or `undefined` when the parent has no imported spec
   * attached. */
  apiDocumentation: ApiDocumentation | undefined
  /** RouteLike for the request, with the URL resolved against the
   * folder's first environment variables — `{{baseUrl}}/pet/{{id}}`
   * becomes `https://api.example.com/pet/{{id}}` so the matcher's
   * regex sees concrete hosts. Path-params not in the env stay
   * literal. */
  route: RouteLike | undefined
}

export function useApiDocumentationFromRequest(request: Request | null): ApiDocumentationFromRequest {
  const findOwningEnvironmentFolder = useRestormStore(state => state.findOwningEnvironmentFolder)
  const collections = useRestormStore(state => state.collections)

  // Stable string discriminant from the route's primitive content.
  // Without it, downstream consumers would memo against a fresh
  // object reference every render — including renders triggered by
  // unrelated reactive-proxy reads — which destabilises the Tabs
  // tree (the URL input would re-mount on every keystroke and
  // break the dirty-registry's debounce).
  const owningFolder = request ? findOwningEnvironmentFolder(request.id) : null
  const routeKey = request
    ? JSON.stringify({
      ...routeFromRequest(request),
      _envVars: envVarsFromFolder(owningFolder)
    })
    : ''

  return useMemo<ApiDocumentationFromRequest>(() => {
    if (!request) return { apiDocumentation: undefined, route: undefined }
    const folder = findOwningEnvironmentFolder(request.id)
    const apiDoc = folder ? apiDocFromItem(folder) : undefined
    const route = routeFromRequest(request)
    if (route.url !== undefined) {
      const envVars = flattenEnvVars(envVarsFromFolder(folder))
      route.url = resolveUrlAgainstEnv(route.url, envVars)
    }
    // Touch deps so the linter sees them used: `routeKey` is the
    // primary discriminant (memo invalidates only when the route's
    // primitive content changes), `request` + `collections` keep
    // the subscription to tree-level mutations live.
    void routeKey
    void collections
    return { apiDocumentation: apiDoc, route }
  }, [routeKey, findOwningEnvironmentFolder, request, collections])
}
