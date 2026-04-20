/**
 * useCompiledDocumentation — renders per-request documentation on the fly from
 * the owning EnvironmentFolder's structured `apiDocumentation` object.
 *
 * The compiler runs in the main process (see `DocumentationCompiler.ts`);
 * this hook locates the owning environment folder, builds the matching
 * discriminants from the current request, invokes the IPC bridge, and caches
 * the result until any discriminant changes.
 */

import { useEffect, useState } from 'react'
import { useRestormStore } from '../store/restormStore'
import type { Request } from '../../../shared/types/collections'
import type { ApiDocumentation } from '../../../shared/types/apiDocumentation'

// ---------- Route discriminants per request type ----------

interface CompilableRoute {
  type: 'http' | 'graphql' | 'grpc' | 'soap' | 'websocket'
  url?: string
  method?: string
  operationType?: string
  query?: string
  service?: string
  rpcMethod?: string
  soapAction?: string
  operation?: string
  event?: string
  protocol?: string
  tags?: string[]
}

function routeFromRequest(request: Request): CompilableRoute {
  switch (request.type) {
    case 'http':
      return { type: 'http', url: request.url, method: request.method, tags: request.tags }
    case 'graphql':
      return {
        type: 'graphql',
        url: request.url,
        operationType: request.operationType,
        query: request.query,
        tags: request.tags
      }
    case 'grpc':
      return {
        type: 'grpc',
        url: request.url,
        service: request.service,
        rpcMethod: request.method,
        tags: request.tags
      }
    case 'soap':
      return {
        type: 'soap',
        url: request.url,
        soapAction: request.soapAction,
        operation: request.operation,
        service: request.service,
        tags: request.tags
      }
    case 'websocket': {
      const route: CompilableRoute = {
        type: 'websocket',
        url: request.url,
        protocol: request.protocol,
        tags: request.tags
      }
      if (request.event !== undefined) route.event = request.event
      return route
    }
  }
}

function apiDocFromItem(item: unknown): ApiDocumentation | undefined {
  if (item && typeof item === 'object' && 'apiDocumentation' in item) {
    const raw = (item as { apiDocumentation?: unknown }).apiDocumentation
    return raw as ApiDocumentation | undefined
  }
  return undefined
}

// ---------- Hook ----------

export interface CompiledDocumentationResult {
  /** Markdown to render in the Docs tab. Empty when no match. */
  markdown: string
  /** `true` if an operation from the owning apiDocumentation matched. */
  matched: boolean
  /** `true` while an IPC compilation is in flight. */
  loading: boolean
}

export function useCompiledDocumentation(request: Request | null): CompiledDocumentationResult {
  const findOwningEnvironmentFolder = useRestormStore(state => state.findOwningEnvironmentFolder)
  // `collections` is pulled in so that edits up the tree (re-imports, refreshes) retrigger the hook.
  const collections = useRestormStore(state => state.collections)

  // Pull out the minimal apiDoc presence so we can render a "no docs" fallback
  // synchronously (lets callers hide the Docs tab without waiting on IPC).
  const owningFolder = request ? findOwningEnvironmentFolder(request.id) : null
  const hasApiDoc = owningFolder ? apiDocFromItem(owningFolder) !== undefined : false

  // Primitive discriminant — stable across identity flips of the (reactive-
  // proxy) request object, so this is what actually triggers a re-compile
  // when any routing-relevant field changes.
  const routeKey = request ? JSON.stringify(routeFromRequest(request)) : ''

  const [compiled, setCompiled] = useState<{ markdown: string; matched: boolean } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!request) return

    const folder = findOwningEnvironmentFolder(request.id)
    const apiDoc = folder ? apiDocFromItem(folder) : undefined
    if (!apiDoc) return

    const route = routeFromRequest(request)

    const api = (window as unknown as { restorm?: { docs?: {
      compileForRoute?: (
        apiDoc: unknown,
        route: CompilableRoute
      ) => Promise<{ matched: boolean; markdown: string; operationId?: string; error?: string }>
    } } }).restorm?.docs?.compileForRoute
    if (!api) return

    let cancelled = false

    // Flip loading on in a microtask so the effect body stays state-free —
    // React 19's `set-state-in-effect` lint rule forbids synchronous calls.
    queueMicrotask(() => {
      if (!cancelled) setLoading(true)
    })

    // Sanitise via a JSON round-trip: reactive-proxy descendants (both on
    // the folder tree and on the request that `route` was built from) break
    // structured-clone when the object goes through the renderer → main
    // IPC boundary.
    const plainApiDoc: unknown = JSON.parse(JSON.stringify(apiDoc))
    const plainRoute = JSON.parse(JSON.stringify(route)) as CompilableRoute
    api(plainApiDoc, plainRoute).then(res => {
      if (cancelled) return
      setCompiled({ markdown: res.markdown, matched: res.matched })
      setLoading(false)
    }).catch(() => {
      if (cancelled) return
      setCompiled(null)
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [request, findOwningEnvironmentFolder, collections, routeKey])

  // Synchronous fallback while the effect hasn't run (or when we have no
  // apiDoc at all): return empty, not-matched so callers hide the Docs tab.
  if (!hasApiDoc) {
    return { markdown: '', matched: false, loading: false }
  }

  return {
    markdown: compiled?.markdown ?? '',
    matched: compiled?.matched ?? false,
    loading
  }
}
