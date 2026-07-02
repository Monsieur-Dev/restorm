import type { Request } from '../../../shared/types/collections'
import type { RouteLike } from '../../../shared/utils/findOperationForRoute'

/**
 * Build a `RouteLike` matcher key from a `Request`. The shape mirrors
 * the matcher's per-protocol discriminants so the result can be fed
 * straight into `findOperationForRoute` / `DocumentationHost.filters`.
 */
export function routeFromRequest(request: Request): RouteLike {
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
      const route: RouteLike = {
        type: 'websocket',
        url: request.url,
        protocol: request.protocol,
        tags: request.tags
      }
      if (request.event !== undefined) route.event = request.event
      return route
    }
    case 'odata':
      // Mirrors the matcher's HTTP-aliased handling — once the matcher
      // gains an OData branch this can be revisited.
      return { type: 'http', url: request.url, tags: request.tags }
    case 'jsonrpc':
    case 'jsonrpcBatch':
      // JSON-RPC has no REST-like path/method — every call is a POST
      // to the same URL with the method name in the body. Alias to a
      // minimal HTTP route (mirrors 'odata') until the matcher gains a
      // JSON-RPC branch that matches on `method` instead of URL.
      return { type: 'http', url: request.url, tags: request.tags }
    case 'auth':
      return { type: 'http', url: request.url, method: request.method, tags: request.tags }
  }
}
