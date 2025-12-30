/**
 * GraphQL Client - Generic GraphQL client for renderer process
 * 
 * Provides a simple GraphQL client that works in both Electron and web modes.
 * In Electron mode, it connects to the local GraphQL server in the main process.
 * In web mode, it can connect to any GraphQL endpoint.
 */

import { logger } from './logger'

/**
 * GraphQL operation result
 */
export interface GraphQLResult<T = unknown> {
  data?: T
  errors?: {
    message: string
    locations?: { line: number; column: number }[]
    path?: (string | number)[]
  }[]
}

/**
 * GraphQL Client configuration
 */
export interface GraphQLClientConfig {
  /** GraphQL endpoint URL */
  endpoint: string
  /** Default headers to include in requests */
  headers?: Record<string, string>
}

/**
 * GraphQL Client for making queries, mutations, and subscriptions
 */
class GraphQLClient {
  private endpoint = ''
  private headers: Record<string, string> = {}
  private isInitialized = false

  /**
   * Initialize the GraphQL client
   */
  initialize(config: GraphQLClientConfig): void {
    this.endpoint = config.endpoint
    this.headers = config.headers ?? {}
    this.isInitialized = true
    logger.info(`[GraphQLClient] Initialized with endpoint: ${this.endpoint}`)
  }

  /**
   * Execute a GraphQL query
   */
  async query<T = unknown>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<GraphQLResult<T>> {
    return this.execute<T>(query, variables)
  }

  /**
   * Execute a GraphQL mutation
   */
  async mutate<T = unknown>(
    mutation: string,
    variables?: Record<string, unknown>
  ): Promise<GraphQLResult<T>> {
    return this.execute<T>(mutation, variables)
  }

  /**
   * Execute a GraphQL operation (query or mutation)
   */
  private async execute<T = unknown>(
    operation: string,
    variables?: Record<string, unknown>
  ): Promise<GraphQLResult<T>> {
    if (!this.isInitialized) {
      throw new Error('[GraphQLClient] Not initialized. Call initialize() first.')
    }

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers
        },
        body: JSON.stringify({
          query: operation,
          variables
        })
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const result = await response.json() as GraphQLResult<T>
      
      if (result.errors) {
        logger.warn('[GraphQLClient] GraphQL errors', { errors: result.errors })
      }

      return result
    } catch (error) {
      logger.error('[GraphQLClient] Request failed', { error: String(error) })
      throw error
    }
  }

  /**
   * Subscribe to a GraphQL subscription using Server-Sent Events
   */
  subscribe(
    subscription: string,
    variables?: Record<string, unknown>,
    onData?: (data: unknown) => void,
    onError?: (error: Error) => void
  ): () => void {
    if (!this.isInitialized) {
      throw new Error('[GraphQLClient] Not initialized. Call initialize() first.')
    }

    const url = new URL(this.endpoint)
    url.searchParams.set('query', subscription)
    if (variables) {
      url.searchParams.set('variables', JSON.stringify(variables))
    }

    const eventSource = new EventSource(url.toString())

    eventSource.onmessage = (event) => {
      try {
        const result = JSON.parse(event.data as string) as GraphQLResult
        if (result.data && onData) {
          onData(result.data)
        }
        if (result.errors) {
          logger.warn('[GraphQLClient] Subscription errors', { errors: result.errors })
          if (onError) {
            onError(new Error(result.errors[0]?.message ?? 'Unknown GraphQL error'))
          }
        }
      } catch (error) {
        logger.error('[GraphQLClient] Failed to parse subscription data', { error: String(error) })
        if (onError) {
          onError(error as Error)
        }
      }
    }

    eventSource.onerror = () => {
      logger.error('[GraphQLClient] Subscription error')
      if (onError) {
        onError(new Error('Subscription connection error'))
      }
    }

    // Return unsubscribe function
    return () => {
      eventSource.close()
      logger.debug('[GraphQLClient] Subscription closed')
    }
  }

  /**
   * Check if the client is initialized
   */
  isClientInitialized(): boolean {
    return this.isInitialized
  }

  /**
   * Get the current endpoint
   */
  getEndpoint(): string {
    return this.endpoint
  }
}

/** Singleton instance */
export const graphQLClient = new GraphQLClient()
