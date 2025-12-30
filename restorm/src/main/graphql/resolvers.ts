/**
 * GraphQL Resolvers for Restorm
 *
 * Implements the GraphQL resolvers for Restorm objects.
 * Connects to the CollectionStore for data management.
 */

import { searchService, logger } from 'electron-core-ui/main'
import { contextService } from '../services'
import { collectionStore, pubsub, PUBSUB_TOPICS } from '../services/CollectionStore'

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

// Type resolver for union types
const typeResolvers = {
  Request: {
    __resolveType(obj: Record<string, unknown>): string {
      switch (obj.type) {
        case 'http': return 'HTTPRequest'
        case 'graphql': return 'GraphQLRequest'
        case 'grpc': return 'GrpcRequest'
        case 'soap': return 'SoapRequest'
        case 'websocket': return 'WebSocketRequest'
        default: return 'HTTPRequest'
      }
    }
  },
  FolderItem: {
    __resolveType(obj: Record<string, unknown>): string {
      if (obj.folderType === 'environment') return 'EnvironmentFolder'
      if (obj.items !== undefined && obj.type === undefined) return 'Folder'
      switch (obj.type) {
        case 'http': return 'HTTPRequest'
        case 'graphql': return 'GraphQLRequest'
        case 'grpc': return 'GrpcRequest'
        case 'soap': return 'SoapRequest'
        case 'websocket': return 'WebSocketRequest'
        default: return 'Folder'
      }
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
    }
  },

  Mutation: {
    createFolder: (_: unknown, { parentId, input }: { parentId: string | null; input: unknown }): unknown => {
      logger.debug('[GraphQL] createFolder mutation', { parentId, input })
      const folder = input as { id?: string; name: string; items?: unknown[] }
      return collectionStore.createFolder(parentId, {
        id: folder.id ?? '',
        name: folder.name
      })
    },

    updateFolder: (_: unknown, { id, input }: { id: string; input: unknown }): unknown => {
      logger.debug('[GraphQL] updateFolder mutation', { id, input })
      return collectionStore.updateFolder(id, input as { name?: string })
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
      const request = input as { id?: string; name: string; type: 'http' | 'graphql' | 'grpc' | 'soap' | 'websocket' }
      return collectionStore.createRequest(parentId, {
        id: request.id ?? '',
        name: request.name,
        type: request.type
      })
    },

    updateRequest: (_: unknown, { id, input }: { id: string; input: unknown }): unknown => {
      logger.debug('[GraphQL] updateRequest mutation', { id, input })
      return collectionStore.updateRequest(id, input as { name?: string })
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
      const env = input as { id?: string; name: string; variables?: { key: string; value: string }[] }
      return collectionStore.createEnvironment(parentId, {
        id: env.id ?? '',
        name: env.name,
        variables: env.variables ?? []
      }, parentEnvironmentId)
    },

    updateEnvironment: (_: unknown, { id, input }: { id: string; input: unknown }): unknown => {
      logger.debug('[GraphQL] updateEnvironment mutation', { id, input })
      return collectionStore.updateEnvironment(id, input as { name?: string })
    },

    deleteEnvironment: (_: unknown, { id }: { id: string }): boolean => {
      logger.debug('[GraphQL] deleteEnvironment mutation', { id })
      return collectionStore.deleteEnvironment(id)
    }
  },

  Subscription: {
    folderCreated: {
      subscribe: (): AsyncIterable<unknown> => pubsub.subscribe(PUBSUB_TOPICS.FOLDER_CREATED),
      resolve: (payload: unknown): unknown => ({ folderCreated: payload })
    },
    folderUpdated: {
      subscribe: (): AsyncIterable<unknown> => pubsub.subscribe(PUBSUB_TOPICS.FOLDER_UPDATED),
      resolve: (payload: unknown): unknown => ({ folderUpdated: payload })
    },
    folderDeleted: {
      subscribe: (): AsyncIterable<unknown> => pubsub.subscribe(PUBSUB_TOPICS.FOLDER_DELETED),
      resolve: (payload: unknown): unknown => ({ folderDeleted: payload })
    },
    requestCreated: {
      subscribe: (): AsyncIterable<unknown> => pubsub.subscribe(PUBSUB_TOPICS.REQUEST_CREATED),
      resolve: (payload: unknown): unknown => ({ requestCreated: payload })
    },
    requestUpdated: {
      subscribe: (): AsyncIterable<unknown> => pubsub.subscribe(PUBSUB_TOPICS.REQUEST_UPDATED),
      resolve: (payload: unknown): unknown => ({ requestUpdated: payload })
    },
    requestDeleted: {
      subscribe: (): AsyncIterable<unknown> => pubsub.subscribe(PUBSUB_TOPICS.REQUEST_DELETED),
      resolve: (payload: unknown): unknown => ({ requestDeleted: payload })
    },
    environmentCreated: {
      subscribe: (): AsyncIterable<unknown> => pubsub.subscribe(PUBSUB_TOPICS.ENVIRONMENT_CREATED),
      resolve: (payload: unknown): unknown => ({ environmentCreated: payload })
    },
    environmentUpdated: {
      subscribe: (): AsyncIterable<unknown> => pubsub.subscribe(PUBSUB_TOPICS.ENVIRONMENT_UPDATED),
      resolve: (payload: unknown): unknown => ({ environmentUpdated: payload })
    },
    environmentDeleted: {
      subscribe: (): AsyncIterable<unknown> => pubsub.subscribe(PUBSUB_TOPICS.ENVIRONMENT_DELETED),
      resolve: (payload: unknown): unknown => ({ environmentDeleted: payload })
    },
    contextChanged: {
      subscribe: (_: unknown, { environmentId }: { environmentId: string }): AsyncIterable<unknown> => {
        logger.debug('[GraphQL] contextChanged subscription', { environmentId })
        return pubsub.subscribe(PUBSUB_TOPICS.CONTEXT_CHANGED)
      },
      resolve: (payload: unknown): unknown => ({ contextChanged: payload })
    }
  }
}
