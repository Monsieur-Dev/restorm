/**
 * GraphQL Integration Service for Restorm Renderer
 * 
 * Initializes the GraphQL client and sets up subscriptions to sync
 * with the Zustand store for reactive UI updates.
 */

import { graphQLClient, logger } from 'electron-core-ui/renderer'
import { useRestormStore } from '../store/restormStore'
import type { FolderItem, Environment, Request, Folder } from '../../../shared/types/collections'

// Web-mode fallback: when restorm is opened in a plain browser (no
// preload bridge), no GraphQL server exists. The string is unused but
// passed to `graphQLClient.initialize` so the client doesn't blow up
// on the synchronous code path.
const WEB_FALLBACK_ENDPOINT = 'http://localhost:0/graphql'

// Active subscription cleanup functions
let subscriptionCleanups: (() => void)[] = []

/**
 * Check if we're running in Electron mode (has window.restorm from preload)
 */
function isElectronMode(): boolean {
  return typeof window !== 'undefined' && window.restorm !== undefined
}

/**
 * Resolve the live GraphQL endpoint from the runtime config IPC. The
 * main process picks a free port at boot, so the renderer can't
 * hardcode it. Falls back to a placeholder URL in web mode (no
 * preload bridge) — the subscriptions are then skipped anyway.
 */
async function resolveGraphqlEndpoint(): Promise<string> {
  if (!isElectronMode()) return WEB_FALLBACK_ENDPOINT
  const root = window as {
    restorm?: { runtime?: { getConfig?: () => Promise<{ graphql: { endpoint: string } }> } }
  }
  const getConfig = root.restorm?.runtime?.getConfig
  if (!getConfig) return WEB_FALLBACK_ENDPOINT
  try {
    const cfg = await getConfig()
    return cfg.graphql.endpoint || WEB_FALLBACK_ENDPOINT
  } catch (error) {
    logger.warn('[GraphQLIntegration] runtime:get-config failed', { error: String(error) })
    return WEB_FALLBACK_ENDPOINT
  }
}

/**
 * Initialize the GraphQL client and set up subscriptions
 * Only sets up subscriptions in Electron mode where the GraphQL server exists
 */
export async function initializeGraphQL(): Promise<void> {
  const endpoint = await resolveGraphqlEndpoint()

  graphQLClient.initialize({ endpoint })

  logger.info('[GraphQLIntegration] GraphQL client initialized', { endpoint })

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
  // Tear down any existing subscriptions first so a re-initialize (retry after
  // the GraphQL server wasn't ready, HMR, etc.) doesn't DOUBLE-subscribe and
  // leak the previous set (each store event would then fire twice).
  cleanupGraphQL()

  const store = useRestormStore.getState()

  // Subscribe to folder updates
  const folderUpdatedCleanup = graphQLClient.subscribe(
    // `documentation` is intentionally absent — the field was retired from
    // the `Folder` schema, so querying it here triggered a runtime
    // `GRAPHQL_VALIDATION_FAILED`. Folder docs live elsewhere now (route
    // tag-folders are derived from the parent EnvironmentFolder).
    `subscription { folderUpdated { id name notes tags } }`,
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
function cleanupGraphQL(): void {
  for (const cleanup of subscriptionCleanups) {
    cleanup()
  }
  subscriptionCleanups = []
  logger.info('[GraphQLIntegration] Subscriptions cleaned up')
}

const RESPONSE_HISTORY_LIST_QUERY = `
  query ResponseHistoryList($requestId: String) {
    responseHistoryList(requestId: $requestId) {
      guid
      outcome
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
      type
      outcome
      timestamp
      pinned
      response
      requestMeta
    }
  }
`

interface GraphQLResult<T> {
  data?: T
  errors?: {
    message: string
    locations?: { line: number; column: number }[]
    path?: (string | number)[]
  }[]
}

async function executeGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<GraphQLResult<T>> {
  const api = typeof window !== 'undefined'
    ? window.restorm?.graphqlApi
    : undefined
  if (api) {
    return await api.query(query, variables) as GraphQLResult<T>
  }
  return await graphQLClient.query<T>(query, variables)
}

export async function getResponseHistoryList(requestId: string): Promise<{
  guid: string
  outcome: string
  timestamp: string
  pinned: boolean
}[]> {
  logger.debug('[GraphQLIntegration] responseHistoryList query', { requestId })
  try {
    const result = await executeGraphQL<{ responseHistoryList: {
      guid: string
      outcome: string
      timestamp: string
      pinned: boolean
    }[] }>(RESPONSE_HISTORY_LIST_QUERY, { requestId })
    if (result.errors?.length) {
      logger.warn('[GraphQLIntegration] responseHistoryList errors', { errors: result.errors })
    }
    const entries = result.data?.responseHistoryList ?? []
    logger.debug('[GraphQLIntegration] responseHistoryList result', { count: entries.length })
    return entries
  } catch (error) {
    logger.error('[GraphQLIntegration] responseHistoryList failed', {
      error: String(error),
      endpoint: graphQLClient.getEndpoint(),
      initialized: graphQLClient.isClientInitialized()
    })
    return []
  }
}

export async function getResponseHistoryDetail(guid: string): Promise<{
  guid: string
  requestId: string
  type: string
  outcome: string
  timestamp: string
  pinned: boolean
  response: unknown
  requestMeta?: unknown
} | null> {
  try {
    const result = await executeGraphQL<{ responseHistoryDetail: {
      guid: string
      requestId: string
      type: string
      outcome: string
      timestamp: string
      pinned: boolean
      response: unknown
      requestMeta?: unknown
    } | null }>(RESPONSE_HISTORY_DETAIL_QUERY, { guid })
    if (result.errors?.length) {
      logger.warn('[GraphQLIntegration] responseHistoryDetail errors', { errors: result.errors })
    }
    return result.data?.responseHistoryDetail ?? null
  } catch (error) {
    logger.error('[GraphQLIntegration] responseHistoryDetail failed', {
      error: String(error),
      endpoint: graphQLClient.getEndpoint(),
      initialized: graphQLClient.isClientInitialized(),
      guid
    })
    return null
  }
}
