/**
 * GraphQL Resolvers for Restorm
 *
 * Implements the GraphQL resolvers for Restorm objects.
 * Connects to the CollectionStore for data management.
 */

import { z } from 'zod'
import { searchService, logger } from 'electron-core-ui/main'
import { contextService, responseHistoryService } from '../services'
import { collectionStore, pubsub, PUBSUB_TOPICS } from '../services/CollectionStore'
import { REQUEST_TYPES } from '../../shared/models/types'

// ---------------------------------------------------------------------------
// Mutation input validation
//
// GraphQL inputs arrive untyped; the resolvers used to `as`-cast them straight
// into the store. Parse each create/update input through a zod schema instead,
// so a malformed payload is rejected at the boundary rather than silently
// writing a bad node (the cast hid missing/extra fields).
// ---------------------------------------------------------------------------
const folderCreateSchema = z.object({ id: z.string().optional(), name: z.string() })
const folderUpdateSchema = z.object({ name: z.string().optional() })
const requestCreateSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  type: z.enum(REQUEST_TYPES)
})
const requestUpdateSchema = z.object({ name: z.string().optional() })
const environmentCreateSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  variables: z.array(z.object({ key: z.string(), value: z.string() })).optional()
})
const environmentUpdateSchema = z.object({ name: z.string().optional() })

/** Parse a GraphQL mutation input through a schema, throwing a clear GraphQL
 * error (with the mutation name) when it doesn't match. */
function parseInput<S extends z.ZodType>(schema: S, input: unknown, mutation: string): z.infer<S> {
  const result = schema.safeParse(input)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Invalid input for ${mutation}: ${issues}`)
  }
  return result.data as z.infer<S>
}

/**
 * Set the collections store (called when file is loaded)
 */
export function setCollectionsStore(collections: unknown[]): void {
  collectionStore.setCollections(collections as Parameters<typeof collectionStore.setCollections>[0])
  logger.debug('[GraphQL Resolvers] Collections store updated', { count: collections.length })
}

/**
 * Get the collections store
 */
export function getCollectionsStore(): unknown[] {
  return collectionStore.getCollections()
}

/**
 * Map a request `type` discriminant to its GraphQL union member name. Returns
 * `null` for an unknown discriminant so the caller can throw with context — a
 * silent default (the old `'HTTPRequest'` fallback) made an odata/auth request
 * resolve as HTTPRequest and drop its protocol-specific fields.
 */
function resolveRequestType(type: unknown): string | null {
  switch (type) {
    case 'http': return 'HTTPRequest'
    case 'graphql': return 'GraphQLRequest'
    case 'grpc': return 'GrpcRequest'
    case 'soap': return 'SoapRequest'
    case 'websocket': return 'WebSocketRequest'
    case 'odata': return 'ODataRequest'
    case 'auth': return 'AuthenticationRequest'
    default: return null
  }
}

// Type resolver for union types
const typeResolvers = {
  Request: {
    __resolveType(obj: Record<string, unknown>): string {
      const resolved = resolveRequestType(obj.type)
      if (resolved === null) {
        throw new Error(`Cannot resolve GraphQL Request type for discriminant "${String(obj.type)}"`)
      }
      return resolved
    }
  },
  FolderItem: {
    __resolveType(obj: Record<string, unknown>): string {
      if (obj.folderType === 'environment') return 'EnvironmentFolder'
      if (obj.items !== undefined && obj.type === undefined) return 'Folder'
      const resolved = resolveRequestType(obj.type)
      if (resolved === null) {
        throw new Error(`Cannot resolve GraphQL FolderItem type for discriminant "${String(obj.type)}"`)
      }
      return resolved
    }
  }
}

/**
 * GraphQL resolvers
 */
export const resolvers = {
  ...typeResolvers,

  Query: {
    collections: (): unknown[] => {
      return collectionStore.getCollections()
    },

    folder: (_: unknown, { id }: { id: string }): unknown => {
      return collectionStore.findById(id)
    },

    environmentFolder: (_: unknown, { id }: { id: string }): unknown => {
      const item = collectionStore.findById(id)
      const obj = item as Record<string, unknown> | null
      if (obj?.folderType === 'environment') {
        return item
      }
      return null
    },

    request: (_: unknown, { id }: { id: string }): unknown => {
      const item = collectionStore.findById(id)
      const obj = item as Record<string, unknown> | null
      if (obj?.type && ['http', 'graphql', 'grpc', 'soap', 'websocket'].includes(obj.type as string)) {
        return item
      }
      return null
    },

    environment: (_: unknown, { id }: { id: string }): unknown => {
      const env = collectionStore.findEnvironmentById(id)
      return env
    },

    resolvedContext: (_: unknown, { environmentId }: { environmentId: string }): unknown => {
      logger.debug('[GraphQL] resolvedContext query', { environmentId })
      const context = contextService.getContext(environmentId)
      if (!context) {
        return null
      }
      // Transform the context to GraphQL format
      const variables = Object.entries(context).map(([key, value]) => ({
        key,
        value,
        resolved: value
      }))
      return {
        environmentId,
        variables
      }
    },

    resolvedURL: (_: unknown, { requestId, environmentId }: { requestId: string; environmentId: string }): unknown => {
      logger.debug('[GraphQL] resolvedURL query', { requestId, environmentId })
      const urlResult = contextService.getResolvedUrl(requestId)
      if (!urlResult) {
        return null
      }
      // Find the original URL from the request
      const request = collectionStore.findById(requestId) as Record<string, unknown> | null
      const url = request?.url
      const originalUrl = typeof url === 'string' ? url : ''
      return {
        requestId,
        environmentId,
        original: originalUrl,
        resolved: urlResult.resolvedUrl
      }
    },

    search: (_: unknown, { query, limit }: { query: string; limit?: number }): unknown[] => {
      logger.debug('[GraphQL] search query', { query, limit })
      const results = searchService.search(query, { limit }) as { id: string }[]
      // Transform search results to match GraphQL Request type
      return results.map(result => {
        // Find the actual item in collections to return full data
        const item = collectionStore.findById(result.id)
        return item
      }).filter(Boolean)
    },

    responseHistoryList: async (_: unknown, { requestId }: { requestId?: string }): Promise<unknown[]> => {
      logger.debug('[GraphQL] responseHistoryList query', { requestId })
      if (typeof requestId === 'string' && requestId) {
        return responseHistoryService.list(requestId)
      }
      return []
    },

    responseHistoryDetail: async (_: unknown, { guid }: { guid: string }): Promise<unknown> => {
      logger.debug('[GraphQL] responseHistoryDetail query', { guid })
      return responseHistoryService.getDetail(guid)
    }
  },

  Mutation: {
    createFolder: (_: unknown, { parentId, input }: { parentId: string | null; input: unknown }): unknown => {
      logger.debug('[GraphQL] createFolder mutation', { parentId, input })
      const folder = parseInput(folderCreateSchema, input, 'createFolder')
      return collectionStore.createFolder(parentId, {
        id: folder.id ?? '',
        name: folder.name
      })
    },

    updateFolder: (_: unknown, { id, input }: { id: string; input: unknown }): unknown => {
      logger.debug('[GraphQL] updateFolder mutation', { id, input })
      return collectionStore.updateFolder(id, parseInput(folderUpdateSchema, input, 'updateFolder'))
    },

    deleteFolder: (_: unknown, { id }: { id: string }): boolean => {
      logger.debug('[GraphQL] deleteFolder mutation', { id })
      return collectionStore.deleteFolder(id)
    },

    moveFolder: (_: unknown, { id, newParentId, index }: { id: string; newParentId: string; index: number }): unknown => {
      logger.debug('[GraphQL] moveFolder mutation', { id, newParentId, index })
      return collectionStore.moveFolder(id, newParentId, index)
    },

    createRequest: (_: unknown, { parentId, input }: { parentId: string; input: unknown }): unknown => {
      logger.debug('[GraphQL] createRequest mutation', { parentId, input })
      const request = parseInput(requestCreateSchema, input, 'createRequest')
      return collectionStore.createRequest(parentId, {
        id: request.id ?? '',
        name: request.name,
        type: request.type
      })
    },

    updateRequest: (_: unknown, { id, input }: { id: string; input: unknown }): unknown => {
      logger.debug('[GraphQL] updateRequest mutation', { id, input })
      return collectionStore.updateRequest(id, parseInput(requestUpdateSchema, input, 'updateRequest'))
    },

    deleteRequest: (_: unknown, { id }: { id: string }): boolean => {
      logger.debug('[GraphQL] deleteRequest mutation', { id })
      return collectionStore.deleteRequest(id)
    },

    moveRequest: (_: unknown, { id, newParentId, index }: { id: string; newParentId: string; index: number }): unknown => {
      logger.debug('[GraphQL] moveRequest mutation', { id, newParentId, index })
      return collectionStore.moveRequest(id, newParentId, index)
    },

    createEnvironment: (_: unknown, { parentId, input, parentEnvironmentId }: { parentId: string; input: unknown; parentEnvironmentId?: string }): unknown => {
      logger.debug('[GraphQL] createEnvironment mutation', { parentId, input, parentEnvironmentId })
      const env = parseInput(environmentCreateSchema, input, 'createEnvironment')
      return collectionStore.createEnvironment(parentId, {
        id: env.id ?? '',
        name: env.name,
        variables: env.variables ?? []
      }, parentEnvironmentId)
    },

    updateEnvironment: (_: unknown, { id, input }: { id: string; input: unknown }): unknown => {
      logger.debug('[GraphQL] updateEnvironment mutation', { id, input })
      return collectionStore.updateEnvironment(id, parseInput(environmentUpdateSchema, input, 'updateEnvironment'))
    },

    deleteEnvironment: (_: unknown, { id }: { id: string }): boolean => {
      logger.debug('[GraphQL] deleteEnvironment mutation', { id })
      return collectionStore.deleteEnvironment(id)
    }
  },

  // Each `subscribe` yields the published payload directly (the folder /
  // environment / request entity, or a deleted id). `resolve` must
  // therefore return that payload as the field value. Wrapping it
  // (`{ folderUpdated: payload }`) made the field resolve to an object
  // with no `id`, tripping `Cannot return null for non-nullable field
  // Folder.id` on every folder / environment update and leaving the
  // subscriptions dead — the renderer's handlers are echo-guarded
  // (`shouldIgnoreEvent(id, 'graphql')`), so they were meant to run.
  Subscription: {
    folderCreated: {
      subscribe: (): AsyncIterable<unknown> => pubsub.subscribe(PUBSUB_TOPICS.FOLDER_CREATED),
      resolve: (payload: unknown): unknown => payload
    },
    folderUpdated: {
      subscribe: (): AsyncIterable<unknown> => pubsub.subscribe(PUBSUB_TOPICS.FOLDER_UPDATED),
      resolve: (payload: unknown): unknown => payload
    },
    folderDeleted: {
      subscribe: (): AsyncIterable<unknown> => pubsub.subscribe(PUBSUB_TOPICS.FOLDER_DELETED),
      resolve: (payload: unknown): unknown => payload
    },
    requestCreated: {
      subscribe: (): AsyncIterable<unknown> => pubsub.subscribe(PUBSUB_TOPICS.REQUEST_CREATED),
      resolve: (payload: unknown): unknown => payload
    },
    requestUpdated: {
      subscribe: (): AsyncIterable<unknown> => pubsub.subscribe(PUBSUB_TOPICS.REQUEST_UPDATED),
      resolve: (payload: unknown): unknown => payload
    },
    requestDeleted: {
      subscribe: (): AsyncIterable<unknown> => pubsub.subscribe(PUBSUB_TOPICS.REQUEST_DELETED),
      resolve: (payload: unknown): unknown => payload
    },
    environmentCreated: {
      subscribe: (): AsyncIterable<unknown> => pubsub.subscribe(PUBSUB_TOPICS.ENVIRONMENT_CREATED),
      resolve: (payload: unknown): unknown => payload
    },
    environmentUpdated: {
      subscribe: (): AsyncIterable<unknown> => pubsub.subscribe(PUBSUB_TOPICS.ENVIRONMENT_UPDATED),
      resolve: (payload: unknown): unknown => payload
    },
    environmentDeleted: {
      subscribe: (): AsyncIterable<unknown> => pubsub.subscribe(PUBSUB_TOPICS.ENVIRONMENT_DELETED),
      resolve: (payload: unknown): unknown => payload
    },
    contextChanged: {
      subscribe: (_: unknown, { environmentId }: { environmentId: string }): AsyncIterable<unknown> => {
        logger.debug('[GraphQL] contextChanged subscription', { environmentId })
        return pubsub.subscribe(PUBSUB_TOPICS.CONTEXT_CHANGED)
      },
      resolve: (payload: unknown): unknown => payload
    },
    searchIndexUpdated: {
      subscribe: (): AsyncIterable<unknown> => pubsub.subscribe(PUBSUB_TOPICS.SEARCH_INDEX_UPDATED),
      resolve: (payload: unknown): unknown => payload
    }
  }
}
