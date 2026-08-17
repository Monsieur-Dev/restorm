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
import { resolveUrlAgainstEnv, flattenEnvVars, coerceEnvVarValue } from '../../../shared/utils/resolveUrlAgainstEnv'
import type { EnvironmentFolder } from '../../../shared/types/folderTypes'
import { routeFromRequest } from './routeFromRequest'
import { mergeEnumDefinitionsIntoModels } from '../components/documentation/mergeEnumDefinitions'

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
    const coerced = coerceEnvVarValue(kv.value)
    if (coerced !== undefined) out[kv.key] = coerced
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
    const rawApiDoc = folder ? apiDocFromItem(folder) : undefined
    const apiDoc = rawApiDoc !== undefined
      ? mergeEnumDefinitionsIntoModels(rawApiDoc, folder?.enumDefinitions)
      : undefined
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
