/**
 * GraphQL Integration Service for Restorm Renderer
 * 
 * Initializes the GraphQL client and sets up subscriptions to sync
 * with the Zustand store for reactive UI updates.
 */

import { graphQLClient, logger } from 'electron-core-ui/renderer'
import { useRestormStore } from '../store/restormStore'
import type { EnvironmentFolder, FolderItem, Environment, Request, Folder } from '../types/collections'

// GraphQL endpoint - must match the port in restorm/src/main/index.ts
const GRAPHQL_ENDPOINT = 'http://localhost:4123/graphql'

// Active subscription cleanup functions
let subscriptionCleanups: (() => void)[] = []

/**
 * Check if we're running in Electron mode (has window.restorm from preload)
 */
function isElectronMode(): boolean {
  return typeof window !== 'undefined' && window.restorm !== undefined
}

/**
 * Initialize the GraphQL client and set up subscriptions
 * Only sets up subscriptions in Electron mode where the GraphQL server exists
 */
export function initializeGraphQL(): void {
  // Initialize the client
  graphQLClient.initialize({
    endpoint: GRAPHQL_ENDPOINT
  })

  logger.info('[GraphQLIntegration] GraphQL client initialized')

  // Only set up subscriptions in Electron mode where the GraphQL server exists
  // In web mode, there's no GraphQL server and subscriptions would fail
  if (isElectronMode()) {
    setupSubscriptions()
  } else {
    logger.info('[GraphQLIntegration] Skipping subscriptions in web mode (no GraphQL server)')
  }
}

/**
 * Set up GraphQL subscriptions to sync with the store
 */
function setupSubscriptions(): void {
  const store = useRestormStore.getState()

  // Subscribe to folder updates
  const folderUpdatedCleanup = graphQLClient.subscribe(
    `subscription { folderUpdated { id name documentation notes tags } }`,
    undefined,
    (data) => {
      const payload = (data as { folderUpdated?: Partial<Folder> | null }).folderUpdated
      if (payload?.id && !store.shouldIgnoreEvent(payload.id, 'graphql')) {
        store.updateItem(payload.id, payload as Partial<FolderItem>, 'graphql')
      }
    },
    (error) => {
      logger.warn('[GraphQLIntegration] Folder subscription error', { error: error.message })
    }
  )
  subscriptionCleanups.push(folderUpdatedCleanup)

  // Subscribe to folder deletion (returns String! directly)
  const folderDeletedCleanup = graphQLClient.subscribe(
    `subscription { folderDeleted }`,
    undefined,
    (data) => {
      const id = (data as { folderDeleted?: string | null }).folderDeleted
      if (id && !store.shouldIgnoreEvent(id, 'graphql')) {
        store.deleteItem(id, 'graphql')
      }
    },
    (error) => {
      logger.warn('[GraphQLIntegration] Folder deletion subscription error', { error: error.message })
    }
  )
  subscriptionCleanups.push(folderDeletedCleanup)

  // Subscribe to request updates (Request is a union type, use inline fragments)
  const requestUpdatedCleanup = graphQLClient.subscribe(
    `subscription { 
      requestUpdated { 
        ... on HTTPRequest { id name type method url documentation tags }
        ... on GraphQLRequest { id name type url documentation tags }
        ... on GrpcRequest { id name type url documentation tags }
        ... on SoapRequest { id name type url documentation tags }
        ... on WebSocketRequest { id name type url documentation tags }
      } 
    }`,
    undefined,
    (data) => {
      const payload = (data as { requestUpdated?: Partial<Request> | null }).requestUpdated
      if (payload?.id && !store.shouldIgnoreEvent(payload.id, 'graphql')) {
        store.updateItem(payload.id, payload as Partial<FolderItem>, 'graphql')
      }
    },
    (error) => {
      logger.warn('[GraphQLIntegration] Request subscription error', { error: error.message })
    }
  )
  subscriptionCleanups.push(requestUpdatedCleanup)

  // Subscribe to request deletion (returns String! directly)
  const requestDeletedCleanup = graphQLClient.subscribe(
    `subscription { requestDeleted }`,
    undefined,
    (data) => {
      const id = (data as { requestDeleted?: string | null }).requestDeleted
      if (id && !store.shouldIgnoreEvent(id, 'graphql')) {
        store.deleteItem(id, 'graphql')
      }
    },
    (error) => {
      logger.warn('[GraphQLIntegration] Request deletion subscription error', { error: error.message })
    }
  )
  subscriptionCleanups.push(requestDeletedCleanup)

  // Subscribe to environment updates
  const environmentUpdatedCleanup = graphQLClient.subscribe(
    `subscription { environmentUpdated { id name variables { key value description } } }`,
    undefined,
    (data) => {
      const payload = (data as { environmentUpdated?: Partial<Environment> | null }).environmentUpdated
      if (payload?.id && !store.shouldIgnoreEvent(payload.id, 'graphql')) {
        store.updateEnvironment(payload.id, payload, 'graphql')
      }
    },
    (error) => {
      logger.warn('[GraphQLIntegration] Environment subscription error', { error: error.message })
    }
  )
  subscriptionCleanups.push(environmentUpdatedCleanup)

  // Subscribe to environment deletion (returns String! directly)
  const environmentDeletedCleanup = graphQLClient.subscribe(
    `subscription { environmentDeleted }`,
    undefined,
    (data) => {
      const id = (data as { environmentDeleted?: string | null }).environmentDeleted
      if (id && !store.shouldIgnoreEvent(id, 'graphql')) {
        store.deleteEnvironment(id, 'graphql')
      }
    },
    (error) => {
      logger.warn('[GraphQLIntegration] Environment deletion subscription error', { error: error.message })
    }
  )
  subscriptionCleanups.push(environmentDeletedCleanup)

  logger.info('[GraphQLIntegration] Subscriptions set up')
}

/**
 * Clean up all subscriptions
 */
export function cleanupGraphQL(): void {
  for (const cleanup of subscriptionCleanups) {
    cleanup()
  }
  subscriptionCleanups = []
  logger.info('[GraphQLIntegration] Subscriptions cleaned up')
}

// ============================================================================
// GraphQL Queries
// ============================================================================

const COLLECTIONS_QUERY = `
  query GetCollections {
    collections {
      id
      name
      folderType
      documentation
      tags
      items {
        ... on Folder {
          id
          name
          documentation
          tags
          items {
            ... on HTTPRequest {
              id
              name
              type
              method
              url
              documentation
              tags
            }
            ... on Folder {
              id
              name
              documentation
              tags
            }
          }
        }
        ... on HTTPRequest {
          id
          name
          type
          method
          url
          documentation
          tags
        }
      }
      environments {
        id
        name
        variables {
          key
          value
          description
          isSecret
        }
        subEnvironments {
          id
          name
          variables {
            key
            value
            description
            isSecret
          }
        }
      }
    }
  }
`

const SEARCH_QUERY = `
  query Search($query: String!, $limit: Int) {
    search(query: $query, limit: $limit) {
      ... on Folder {
        id
        name
        documentation
        tags
      }
      ... on HTTPRequest {
        id
        name
        type
        method
        url
        documentation
        tags
      }
    }
  }
`

const RESOLVED_CONTEXT_QUERY = `
  query GetResolvedContext($environmentId: ID!) {
    resolvedContext(environmentId: $environmentId) {
      environmentId
      variables {
        key
        value
        resolved
      }
    }
  }
`

const RESOLVED_URL_QUERY = `
  query GetResolvedURL($requestId: ID!, $environmentId: ID!) {
    resolvedURL(requestId: $requestId, environmentId: $environmentId) {
      requestId
      environmentId
      original
      resolved
    }
  }
`

// ============================================================================
// GraphQL Mutations
// ============================================================================

const CREATE_FOLDER_MUTATION = `
  mutation CreateFolder($parentId: ID, $input: FolderInput!) {
    createFolder(parentId: $parentId, input: $input) {
      id
      name
      documentation
      tags
    }
  }
`

const UPDATE_FOLDER_MUTATION = `
  mutation UpdateFolder($id: ID!, $input: FolderInput!) {
    updateFolder(id: $id, input: $input) {
      id
      name
      documentation
      tags
    }
  }
`

const DELETE_FOLDER_MUTATION = `
  mutation DeleteFolder($id: ID!) {
    deleteFolder(id: $id)
  }
`

const CREATE_REQUEST_MUTATION = `
  mutation CreateRequest($parentId: ID!, $input: RequestInput!) {
    createRequest(parentId: $parentId, input: $input) {
      ... on HTTPRequest {
        id
        name
        type
        method
        url
      }
    }
  }
`

const UPDATE_REQUEST_MUTATION = `
  mutation UpdateRequest($id: ID!, $input: RequestInput!) {
    updateRequest(id: $id, input: $input) {
      ... on HTTPRequest {
        id
        name
        type
        method
        url
      }
    }
  }
`

const DELETE_REQUEST_MUTATION = `
  mutation DeleteRequest($id: ID!) {
    deleteRequest(id: $id)
  }
`

const CREATE_ENVIRONMENT_MUTATION = `
  mutation CreateEnvironment($parentId: ID!, $input: EnvironmentInput!, $parentEnvironmentId: ID) {
    createEnvironment(parentId: $parentId, input: $input, parentEnvironmentId: $parentEnvironmentId) {
      id
      name
      variables {
        key
        value
        description
        isSecret
      }
    }
  }
`

const UPDATE_ENVIRONMENT_MUTATION = `
  mutation UpdateEnvironment($id: ID!, $input: EnvironmentInput!) {
    updateEnvironment(id: $id, input: $input) {
      id
      name
      variables {
        key
        value
        description
        isSecret
      }
    }
  }
`

const DELETE_ENVIRONMENT_MUTATION = `
  mutation DeleteEnvironment($id: ID!) {
    deleteEnvironment(id: $id)
  }
`

const RESPONSE_HISTORY_LIST_QUERY = `
  query ResponseHistoryList($requestId: String!) {
    responseHistoryList(requestId: $requestId) {
      guid
      requestId
      requestPath
      type
      success
      timestamp
      pinned
    }
  }
`

const RESPONSE_HISTORY_DETAIL_QUERY = `
  query ResponseHistoryDetail($guid: String!) {
    responseHistoryDetail(guid: $guid) {
      guid
      requestId
      requestPath
      type
      success
      timestamp
      pinned
      response
      requestMeta
    }
  }
`

// ============================================================================
// API Functions
// ============================================================================

/**
 * Fetch all collections from the GraphQL server
 */
export async function fetchCollections(): Promise<EnvironmentFolder[]> {
  const result = await graphQLClient.query<{ collections: EnvironmentFolder[] }>(COLLECTIONS_QUERY)
  return result.data?.collections ?? []
}

/**
 * Search for items using GraphQL
 */
export async function searchItems(query: string, limit?: number): Promise<FolderItem[]> {
  const result = await graphQLClient.query<{ search: FolderItem[] }>(
    SEARCH_QUERY,
    { query, limit }
  )
  return result.data?.search ?? []
}

/**
 * Get resolved context for an environment
 */
export async function getResolvedContext(environmentId: string): Promise<{
  environmentId: string
  variables: { key: string; value: string; resolved: string }[]
} | null> {
  const result = await graphQLClient.query<{
    resolvedContext: {
      environmentId: string
      variables: { key: string; value: string; resolved: string }[]
    } | null
  }>(RESOLVED_CONTEXT_QUERY, { environmentId })
  return result.data?.resolvedContext ?? null
}

/**
 * Get resolved URL for a request
 */
export async function getResolvedURL(requestId: string, environmentId: string): Promise<{
  requestId: string
  environmentId: string
  original: string
  resolved: string
} | null> {
  const result = await graphQLClient.query<{
    resolvedURL: {
      requestId: string
      environmentId: string
      original: string
      resolved: string
    } | null
  }>(RESOLVED_URL_QUERY, { requestId, environmentId })
  return result.data?.resolvedURL ?? null
}

/**
 * Create a new folder
 */
export async function createFolder(parentId: string | null, input: {
  name: string
  documentation?: string
  tags?: string[]
}): Promise<Folder | null> {
  const result = await graphQLClient.mutate<{ createFolder: Folder }>(
    CREATE_FOLDER_MUTATION,
    { parentId, input }
  )
  return result.data?.createFolder ?? null
}

/**
 * Update a folder
 */
export async function updateFolder(id: string, input: {
  name?: string
  documentation?: string
  tags?: string[]
}): Promise<Folder | null> {
  const result = await graphQLClient.mutate<{ updateFolder: Folder }>(
    UPDATE_FOLDER_MUTATION,
    { id, input }
  )
  return result.data?.updateFolder ?? null
}

/**
 * Delete a folder
 */
export async function deleteFolder(id: string): Promise<boolean> {
  const result = await graphQLClient.mutate<{ deleteFolder: boolean }>(
    DELETE_FOLDER_MUTATION,
    { id }
  )
  return result.data?.deleteFolder ?? false
}

/**
 * Create a new request
 */
export async function createRequest(parentId: string, input: {
  name: string
  type: string
  method?: string
  url?: string
}): Promise<Request | null> {
  const result = await graphQLClient.mutate<{ createRequest: Request }>(
    CREATE_REQUEST_MUTATION,
    { parentId, input }
  )
  return result.data?.createRequest ?? null
}

/**
 * Update a request
 */
export async function updateRequest(id: string, input: {
  name?: string
  method?: string
  url?: string
}): Promise<Request | null> {
  const result = await graphQLClient.mutate<{ updateRequest: Request }>(
    UPDATE_REQUEST_MUTATION,
    { id, input }
  )
  return result.data?.updateRequest ?? null
}

/**
 * Delete a request
 */
export async function deleteRequest(id: string): Promise<boolean> {
  const result = await graphQLClient.mutate<{ deleteRequest: boolean }>(
    DELETE_REQUEST_MUTATION,
    { id }
  )
  return result.data?.deleteRequest ?? false
}

/**
 * Create a new environment
 */
export async function createEnvironment(parentId: string, input: {
  name: string
  variables?: { key: string; value: string; description?: string; isSecret?: boolean }[]
}, parentEnvironmentId?: string): Promise<Environment | null> {
  const result = await graphQLClient.mutate<{ createEnvironment: Environment }>(
    CREATE_ENVIRONMENT_MUTATION,
    { parentId, input, parentEnvironmentId }
  )
  return result.data?.createEnvironment ?? null
}

/**
 * Update an environment
 */
export async function updateEnvironment(id: string, input: {
  name?: string
  variables?: { key: string; value: string; description?: string; isSecret?: boolean }[]
}): Promise<Environment | null> {
  const result = await graphQLClient.mutate<{ updateEnvironment: Environment }>(
    UPDATE_ENVIRONMENT_MUTATION,
    { id, input }
  )
  return result.data?.updateEnvironment ?? null
}

/**
 * Delete an environment
 */
export async function deleteEnvironment(id: string): Promise<boolean> {
  const result = await graphQLClient.mutate<{ deleteEnvironment: boolean }>(
    DELETE_ENVIRONMENT_MUTATION,
    { id }
  )
  return result.data?.deleteEnvironment ?? false
}

export async function getResponseHistoryList(requestId: string): Promise<{
  guid: string
  requestId: string
  requestPath: string
  type: string
  success: boolean
  timestamp: string
  pinned: boolean
}[]> {
  const result = await graphQLClient.query<{ responseHistoryList: {
    guid: string
    requestId: string
    requestPath: string
    type: string
    success: boolean
    timestamp: string
    pinned: boolean
  }[] }>(RESPONSE_HISTORY_LIST_QUERY, { requestId })
  return result.data?.responseHistoryList ?? []
}

export async function getResponseHistoryDetail(guid: string): Promise<{
  guid: string
  requestId: string
  requestPath: string
  type: string
  success: boolean
  timestamp: string
  pinned: boolean
  response: unknown
  requestMeta?: unknown
} | null> {
  const result = await graphQLClient.query<{ responseHistoryDetail: {
    guid: string
    requestId: string
    requestPath: string
    type: string
    success: boolean
    timestamp: string
    pinned: boolean
    response: unknown
    requestMeta?: unknown
  } | null }>(RESPONSE_HISTORY_DETAIL_QUERY, { guid })
  return result.data?.responseHistoryDetail ?? null
}
