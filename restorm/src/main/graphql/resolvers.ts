/**
 * GraphQL Resolvers for Restorm
 * 
 * Implements the GraphQL resolvers for Restorm objects.
 * Connects to the event system and store for data management.
 */

import { createPubSub, type PubSub, searchService } from 'electron-core-ui/main'
import { eventBusService, logger } from 'electron-core-ui/main'
import { DocumentEvents, type DocumentChangedPayload, type DocumentDeletedPayload } from '../services/DocumentEvents'
import { contextService } from '../services'

// PubSub events for subscriptions
const PUBSUB_EVENTS = {
  FOLDER_CREATED: 'FOLDER_CREATED',
  FOLDER_UPDATED: 'FOLDER_UPDATED',
  FOLDER_DELETED: 'FOLDER_DELETED',
  REQUEST_CREATED: 'REQUEST_CREATED',
  REQUEST_UPDATED: 'REQUEST_UPDATED',
  REQUEST_DELETED: 'REQUEST_DELETED',
  ENVIRONMENT_CREATED: 'ENVIRONMENT_CREATED',
  ENVIRONMENT_UPDATED: 'ENVIRONMENT_UPDATED',
  ENVIRONMENT_DELETED: 'ENVIRONMENT_DELETED',
  CONTEXT_CHANGED: 'CONTEXT_CHANGED'
} as const

// Create PubSub instance for subscriptions
export const pubsub: PubSub<Record<string, unknown>> = createPubSub()

// In-memory store for collections (will be replaced by proper store in task 7)
let collectionsStore: unknown[] = []

/**
 * Initialize event subscriptions to forward to GraphQL subscriptions
 */
export function initializeGraphQLEventBridge(): void {
  // Forward document events to GraphQL subscriptions
  eventBusService.subscribe<DocumentChangedPayload>(DocumentEvents.FOLDER_CREATED, (payload) => {
    pubsub.publish(PUBSUB_EVENTS.FOLDER_CREATED, { folderCreated: payload.document })
  })

  eventBusService.subscribe<DocumentChangedPayload>(DocumentEvents.FOLDER_UPDATED, (payload) => {
    pubsub.publish(PUBSUB_EVENTS.FOLDER_UPDATED, { folderUpdated: payload.document })
  })

  eventBusService.subscribe<DocumentDeletedPayload>(DocumentEvents.FOLDER_DELETED, (payload) => {
    pubsub.publish(PUBSUB_EVENTS.FOLDER_DELETED, { folderDeleted: payload.id })
  })

  eventBusService.subscribe<DocumentChangedPayload>(DocumentEvents.REQUEST_CREATED, (payload) => {
    pubsub.publish(PUBSUB_EVENTS.REQUEST_CREATED, { requestCreated: payload.document })
  })

  eventBusService.subscribe<DocumentChangedPayload>(DocumentEvents.REQUEST_UPDATED, (payload) => {
    pubsub.publish(PUBSUB_EVENTS.REQUEST_UPDATED, { requestUpdated: payload.document })
  })

  eventBusService.subscribe<DocumentDeletedPayload>(DocumentEvents.REQUEST_DELETED, (payload) => {
    pubsub.publish(PUBSUB_EVENTS.REQUEST_DELETED, { requestDeleted: payload.id })
  })

  eventBusService.subscribe<DocumentChangedPayload>(DocumentEvents.ENVIRONMENT_CREATED, (payload) => {
    pubsub.publish(PUBSUB_EVENTS.ENVIRONMENT_CREATED, { environmentCreated: payload.document })
  })

  eventBusService.subscribe<DocumentChangedPayload>(DocumentEvents.ENVIRONMENT_UPDATED, (payload) => {
    pubsub.publish(PUBSUB_EVENTS.ENVIRONMENT_UPDATED, { environmentUpdated: payload.document })
  })

  eventBusService.subscribe<DocumentDeletedPayload>(DocumentEvents.ENVIRONMENT_DELETED, (payload) => {
    pubsub.publish(PUBSUB_EVENTS.ENVIRONMENT_DELETED, { environmentDeleted: payload.id })
  })

  logger.info('[GraphQL Resolvers] Event bridge initialized')
}

/**
 * Set the collections store (called when file is loaded)
 */
export function setCollectionsStore(collections: unknown[]): void {
  collectionsStore = collections
  logger.debug('[GraphQL Resolvers] Collections store updated', { count: collections.length })
}

/**
 * Get the collections store
 */
export function getCollectionsStore(): unknown[] {
  return collectionsStore
}

// Helper to find item by ID recursively
function findById(items: unknown[], id: string): unknown {
  for (const item of items) {
    const obj = item as Record<string, unknown>
    if (obj.id === id) {
      return item
    }
    if (Array.isArray(obj.items)) {
      const found = findById(obj.items as unknown[], id)
      if (found) return found
    }
    if (Array.isArray(obj.environments)) {
      const found = findById(obj.environments as unknown[], id)
      if (found) return found
    }
    if (Array.isArray(obj.subEnvironments)) {
      const found = findById(obj.subEnvironments as unknown[], id)
      if (found) return found
    }
  }
  return null
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
      return collectionsStore
    },

    folder: (_: unknown, { id }: { id: string }): unknown => {
      return findById(collectionsStore, id)
    },

    environmentFolder: (_: unknown, { id }: { id: string }): unknown => {
      const item = findById(collectionsStore, id)
      const obj = item as Record<string, unknown> | null
      if (obj?.folderType === 'environment') {
        return item
      }
      return null
    },

    request: (_: unknown, { id }: { id: string }): unknown => {
      const item = findById(collectionsStore, id)
      const obj = item as Record<string, unknown> | null
      if (obj?.type && ['http', 'graphql', 'grpc', 'soap', 'websocket'].includes(obj.type as string)) {
        return item
      }
      return null
    },

    environment: (_: unknown, { id }: { id: string }): unknown => {
      const item = findById(collectionsStore, id)
      const obj = item as Record<string, unknown> | null
      if (obj?.variables !== undefined) {
        return item
      }
      return null
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
      const request = findById(collectionsStore, requestId) as Record<string, unknown> | null
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
        const item = findById(collectionsStore, result.id)
        return item
      }).filter(Boolean)
    }
  },

  Mutation: {
    createFolder: (_: unknown, { parentId, input }: { parentId: string; input: unknown }): unknown => {
      logger.debug('[GraphQL] createFolder mutation', { parentId, input })
      // TODO: Implement in task 7 (Store)
      return input
    },

    updateFolder: (_: unknown, { id, input }: { id: string; input: unknown }): unknown => {
      logger.debug('[GraphQL] updateFolder mutation', { id, input })
      // TODO: Implement in task 7 (Store)
      return input
    },

    deleteFolder: (_: unknown, { id }: { id: string }): boolean => {
      logger.debug('[GraphQL] deleteFolder mutation', { id })
      // TODO: Implement in task 7 (Store)
      return true
    },

    moveFolder: (_: unknown, { id, newParentId, index }: { id: string; newParentId: string; index: number }): unknown => {
      logger.debug('[GraphQL] moveFolder mutation', { id, newParentId, index })
      // TODO: Implement in task 7 (Store)
      return findById(collectionsStore, id)
    },

    createRequest: (_: unknown, { parentId, input }: { parentId: string; input: unknown }): unknown => {
      logger.debug('[GraphQL] createRequest mutation', { parentId, input })
      // TODO: Implement in task 7 (Store)
      return input
    },

    updateRequest: (_: unknown, { id, input }: { id: string; input: unknown }): unknown => {
      logger.debug('[GraphQL] updateRequest mutation', { id, input })
      // TODO: Implement in task 7 (Store)
      return input
    },

    deleteRequest: (_: unknown, { id }: { id: string }): boolean => {
      logger.debug('[GraphQL] deleteRequest mutation', { id })
      // TODO: Implement in task 7 (Store)
      return true
    },

    moveRequest: (_: unknown, { id, newParentId, index }: { id: string; newParentId: string; index: number }): unknown => {
      logger.debug('[GraphQL] moveRequest mutation', { id, newParentId, index })
      // TODO: Implement in task 7 (Store)
      return findById(collectionsStore, id)
    },

    createEnvironment: (_: unknown, { parentId, input }: { parentId: string; input: unknown }): unknown => {
      logger.debug('[GraphQL] createEnvironment mutation', { parentId, input })
      // TODO: Implement in task 7 (Store)
      return input
    },

    updateEnvironment: (_: unknown, { id, input }: { id: string; input: unknown }): unknown => {
      logger.debug('[GraphQL] updateEnvironment mutation', { id, input })
      // TODO: Implement in task 7 (Store)
      return input
    },

    deleteEnvironment: (_: unknown, { id }: { id: string }): boolean => {
      logger.debug('[GraphQL] deleteEnvironment mutation', { id })
      // TODO: Implement in task 7 (Store)
      return true
    }
  },

  Subscription: {
    folderCreated: {
      subscribe: (): AsyncIterable<unknown> => pubsub.subscribe(PUBSUB_EVENTS.FOLDER_CREATED)
    },
    folderUpdated: {
      subscribe: (): AsyncIterable<unknown> => pubsub.subscribe(PUBSUB_EVENTS.FOLDER_UPDATED)
    },
    folderDeleted: {
      subscribe: (): AsyncIterable<unknown> => pubsub.subscribe(PUBSUB_EVENTS.FOLDER_DELETED)
    },
    requestCreated: {
      subscribe: (): AsyncIterable<unknown> => pubsub.subscribe(PUBSUB_EVENTS.REQUEST_CREATED)
    },
    requestUpdated: {
      subscribe: (): AsyncIterable<unknown> => pubsub.subscribe(PUBSUB_EVENTS.REQUEST_UPDATED)
    },
    requestDeleted: {
      subscribe: (): AsyncIterable<unknown> => pubsub.subscribe(PUBSUB_EVENTS.REQUEST_DELETED)
    },
    environmentCreated: {
      subscribe: (): AsyncIterable<unknown> => pubsub.subscribe(PUBSUB_EVENTS.ENVIRONMENT_CREATED)
    },
    environmentUpdated: {
      subscribe: (): AsyncIterable<unknown> => pubsub.subscribe(PUBSUB_EVENTS.ENVIRONMENT_UPDATED)
    },
    environmentDeleted: {
      subscribe: (): AsyncIterable<unknown> => pubsub.subscribe(PUBSUB_EVENTS.ENVIRONMENT_DELETED)
    },
    contextChanged: {
      subscribe: (_: unknown, { environmentId }: { environmentId: string }): AsyncIterable<unknown> => {
        logger.debug('[GraphQL] contextChanged subscription', { environmentId })
        return pubsub.subscribe(PUBSUB_EVENTS.CONTEXT_CHANGED)
      }
    }
  }
}
