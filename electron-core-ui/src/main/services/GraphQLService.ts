/**
 * GraphQL Service - Generic GraphQL server for Electron main process
 * 
 * Provides a GraphQL server that can be used by any Electron application.
 * The schema and resolvers are provided by the consuming application.
 */

import { createSchema, createYoga } from 'graphql-yoga'
import { createServer } from 'http'
import type { Server } from 'http'
import { createPubSub } from '@graphql-yoga/subscription'
import type { PubSub } from '@graphql-yoga/subscription'
import { logger } from './LoggerService'

// Re-export for consumers
export { createSchema, createPubSub }
export type { PubSub }

// Generic types for GraphQL configuration
type GenericPubSub = PubSub<Record<string, [unknown] | [string | number, unknown]>>

/**
 * GraphQL Service configuration
 */
export interface GraphQLServiceConfig {
  /** Port to run the GraphQL server on (default: 4000) */
  port?: number
  /** GraphQL schema definition */
  typeDefs: string
  /** GraphQL resolvers - passed directly to createSchema */
  resolvers: Parameters<typeof createSchema>[0]['resolvers']
  /** PubSub instance for subscriptions (optional) */
  pubsub?: GenericPubSub
  /** Context factory function */
  context?: () => Record<string, unknown>
}

/**
 * GraphQL Service - Manages a GraphQL server in the main process
 */
class GraphQLService {
  private yoga: ReturnType<typeof createYoga> | null = null
  private server: Server | null = null
  private port = 4000
  private isRunning = false

  /**
   * Initialize the GraphQL server with the provided configuration
   */
  initialize(config: GraphQLServiceConfig): void {
    if (this.isRunning) {
      logger.warn('[GraphQLService] Server already running, stopping first...')
      this.stop()
    }

    this.port = config.port ?? 4000

    // Build yoga options
    const yogaOptions: Parameters<typeof createYoga>[0] = {
      graphqlEndpoint: '/graphql',
      landingPage: false,
      logging: {
        debug: (...args: unknown[]) => { logger.debug('[GraphQL]', { args }); },
        info: (...args: unknown[]) => { logger.info('[GraphQL]', { args }); },
        warn: (...args: unknown[]) => { logger.warn('[GraphQL]', { args }); },
        error: (...args: unknown[]) => { logger.error('[GraphQL]', { args }); }
      }
    }

    // Add schema
    if (config.resolvers) {
      yogaOptions.schema = createSchema({
        typeDefs: config.typeDefs,
        resolvers: config.resolvers
      })
    }

    // Add context if provided
    if (config.context) {
      yogaOptions.context = config.context
    }

    this.yoga = createYoga(yogaOptions)

    logger.info('[GraphQLService] Initialized with schema')
  }

  /**
   * Start the GraphQL server
   */
  async start(): Promise<void> {
    const yoga = this.yoga
    if (!yoga) {
      throw new Error('[GraphQLService] Not initialized. Call initialize() first.')
    }

    if (this.isRunning) {
      logger.warn('[GraphQLService] Server already running')
      return
    }

    return new Promise((resolve, reject) => {
      try {
        // Create HTTP server with yoga as request handler
        // The yoga handler is async but http.createServer handles it correctly
        this.server = createServer((req, res) => {
          void yoga(req, res)
        })
        
        this.server.listen(this.port, () => {
          this.isRunning = true
          logger.info(`[GraphQLService] Server running at http://localhost:${this.port}/graphql`)
          resolve()
        })

        this.server.on('error', (err) => {
          logger.error('[GraphQLService] Server error', { error: String(err) })
          reject(new Error(`Server error: ${String(err)}`))
        })
      } catch (err) {
        logger.error('[GraphQLService] Failed to start server', { error: String(err) })
        reject(new Error(`Failed to start server: ${String(err)}`))
      }
    })
  }

  /**
   * Stop the GraphQL server
   */
  stop(): void {
    if (this.server) {
      this.server.close()
      this.server = null
      this.isRunning = false
      logger.info('[GraphQLService] Server stopped')
    }
  }

  /**
   * Check if the server is running
   */
  isServerRunning(): boolean {
    return this.isRunning
  }

  /**
   * Get the server port
   */
  getPort(): number {
    return this.port
  }

  /**
   * Get the GraphQL endpoint URL
   */
  getEndpoint(): string {
    return `http://localhost:${this.port}/graphql`
  }
}

/** Singleton instance */
export const graphQLService = new GraphQLService()
