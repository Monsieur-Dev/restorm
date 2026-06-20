/**
 * GraphQL Client - Generic GraphQL client for renderer process
 *
 * Provides a simple GraphQL client that works in both Electron and web modes.
 * In Electron mode, it connects to the local GraphQL server in the main process.
 * In web mode, it can connect to any GraphQL endpoint.
 */

import { createClient, type Client } from 'graphql-sse'
import { logger } from './logger'
import {
  computeBackoffDelay,
  FAILED_AFTER_RECONNECTING_MS,
  type GraphQLLinkStatus
} from './graphqlLinkStatus'

export type { GraphQLLinkStatus } from './graphqlLinkStatus'

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
 * GraphQL Client for making queries, mutations, and subscriptions.
 *
 * Subscription transport is graphql-sse in distinct-connection mode (one
 * SSE stream per active subscription). On network errors graphql-sse
 * silently retries — we configure that retry behaviour here
 * (`retryAttempts: Infinity`, custom exponential backoff with jitter,
 * `on.{connecting,connected}` hooked into {@link GraphQLLinkStatus}) so
 * that:
 *
 * - Transient disconnects (main-process restart in dev, sleep/wake,
 *   Wi-Fi swap, kernel hiccup on localhost) recover in <1 s without
 *   any UI intervention.
 * - Consumers can observe transitions via `onLinkStatusChange` /
 *   `getLinkStatus` instead of silently going stale.
 * - Persistent failures are escalated from `reconnecting` to `failed`
 *   after {@link FAILED_AFTER_CONSECUTIVE_ATTEMPTS} consecutive
 *   attempts without a successful (re)connection — the retry keeps
 *   going, but the UI distinction lets us show a different glyph.
 */
class GraphQLClient {
  private endpoint = ''
  private headers: Record<string, string> = {}
  private isInitialized = false
  private sseClient: Client | null = null
  /** Aborts all in-flight execute() fetches; replaced on every initialize() so
   * re-pointing the client cancels POSTs aimed at the old endpoint. */
  private fetchAbort = new AbortController()

  // ---- Link status ----
  private linkStatus: GraphQLLinkStatus = 'ok'
  private readonly linkStatusListeners = new Set<(status: GraphQLLinkStatus) => void>()
  /**
   * Wall-clock timestamp of the first `connecting(reconnecting=true)`
   * event in the current outage, or `null` while the link is healthy.
   * The `reconnecting → failed` escalation checks `now - reconnectingSince
   * >= FAILED_AFTER_RECONNECTING_MS`; a `connected(true)` resets it.
   */
  private reconnectingSince: number | null = null
  // Random number generator, injectable for deterministic tests.
  private random: () => number = Math.random
  // Clock source, injectable for deterministic tests. Defaults to
  // `Date.now` — wall clock is correct here because the wait between
  // `connecting` and `connected` spans `setTimeout`-backed retries, and
  // we care about "how long has the user been without live updates?",
  // which tracks wall time, not process time.
  private now: () => number = Date.now

  /**
   * Initialize the GraphQL client. Safe to call more than once — any
   * previous SSE client is disposed first, and the link-status counters
   * are reset so the new instance starts from a clean `ok` baseline.
   */
  initialize(config: GraphQLClientConfig): void {
    // Dispose the previous client (if any) so its in-flight retries
    // don't keep mutating our state-machine behind the new client's
    // back, and the old `on` listeners stop firing into us.
    if (this.sseClient) {
      try {
        this.sseClient.dispose()
      } catch (error) {
        logger.warn('[GraphQLClient] Failed to dispose previous SSE client', { error: String(error) })
      }
    }
    // Cancel any execute() POSTs still in flight against the OLD endpoint, then
    // arm a fresh controller for the new client.
    this.fetchAbort.abort()
    this.fetchAbort = new AbortController()
    this.reconnectingSince = null
    this.linkStatus = 'ok'

    this.endpoint = config.endpoint
    this.headers = config.headers ?? {}
    this.isInitialized = true

    this.sseClient = createClient({
      url: this.endpoint,
      headers: this.headers,
      // Never give up on retryable errors. Transient outages (main
      // restart, sleep/wake) routinely take >5 attempts; surfacing a
      // permanent error to the UI and forcing a window reload is worse
      // UX than keeping the retry loop going indefinitely. Non-retryable
      // errors (non-2xx HTTP from the server, subscription-level
      // GraphQL errors, server-sent `complete`) still surface terminally
      // via the subscribe `error:` sink — this flag only governs the
      // network-retry budget.
      retryAttempts: Infinity,
      retry: (retries) => this.waitForBackoff(retries),
      on: {
        connecting: (reconnecting) => { this.handleConnecting(reconnecting) },
        connected: (reconnected) => { this.handleConnected(reconnected) }
      }
    })

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
      logger.debug('[GraphQLClient] Executing request', { endpoint: this.endpoint })
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers
        },
        body: JSON.stringify({
          query: operation,
          variables
        }),
        // Cancellable: a re-initialize() (or dispose) aborts in-flight POSTs so
        // a stale request can't resolve into a re-pointed client.
        signal: this.fetchAbort.signal
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      logger.debug('[GraphQLClient] Received response', { status: response.status })
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
   * Subscribe to a GraphQL subscription using graphql-sse.
   *
   * The underlying SSE layer retries transparently on network errors
   * (see class-level docs). The `onError` callback is invoked when
   * graphql-sse surfaces a terminal error after its retry policy has
   * given up — which, with our `retryAttempts: Infinity`, only happens
   * for genuinely non-retryable failures (HTTP 4xx from the server,
   * malformed response, etc.). Retryable network disconnects are now
   * silent from the caller's perspective.
   */
  subscribe(
    subscription: string,
    variables?: Record<string, unknown>,
    onData?: (data: unknown) => void,
    onError?: (error: Error) => void
  ): () => void {
    if (!this.isInitialized || !this.sseClient) {
      throw new Error('[GraphQLClient] Not initialized. Call initialize() first.')
    }

    let unsubscribe: (() => void) | null = null

    try {
      unsubscribe = this.sseClient.subscribe(
        {
          query: subscription,
          ...(variables && { variables })
        },
        {
          next: (result) => {
            if (result.data && onData) {
              onData(result.data)
            }
            if (result.errors) {
              logger.warn('[GraphQLClient] Subscription errors', { errors: result.errors })
              if (onError) {
                onError(new Error(result.errors[0]?.message ?? 'Unknown GraphQL error'))
              }
            }
          },
          error: (error) => {
            // Reached only when graphql-sse's retry policy stops on a
            // non-retryable error — our `retryAttempts: Infinity` keeps
            // the loop going for everything else. Log as `error` because
            // by this point recovery will not happen on its own.
            logger.error('[GraphQLClient] Subscription terminated', { error: String(error) })
            if (onError) {
              onError(error instanceof Error ? error : new Error(String(error)))
            }
          },
          complete: () => {
            logger.debug('[GraphQLClient] Subscription completed')
          }
        }
      )
    } catch (error) {
      logger.error('[GraphQLClient] Failed to start subscription', { error: String(error) })
      if (onError) {
        onError(error instanceof Error ? error : new Error(String(error)))
      }
    }

    return () => {
      if (unsubscribe) {
        unsubscribe()
      }
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

  /**
   * Current snapshot of the SSE link status. See {@link GraphQLLinkStatus}
   * for the meaning of each state.
   */
  getLinkStatus(): GraphQLLinkStatus {
    return this.linkStatus
  }

  /**
   * Subscribe to link-status transitions. Returns an unsubscribe
   * function.
   */
  onLinkStatusChange(listener: (status: GraphQLLinkStatus) => void): () => void {
    this.linkStatusListeners.add(listener)
    return () => {
      this.linkStatusListeners.delete(listener)
    }
  }

  /**
   * Test hook — replaces the RNG used by the jitter calculation so
   * backoff delays become deterministic in unit tests. Not part of
   * the public API surface.
   * @internal
   */
  setRandomForTests(random: () => number): void {
    this.random = random
  }

  /**
   * Test hook — replaces the wall-clock source used by the
   * `reconnecting → failed` escalation. Not part of the public API.
   * @internal
   */
  setClockForTests(now: () => number): void {
    this.now = now
  }

  /**
   * Test hook — drives a link-status transition through `setLinkStatus`
   * so tests go through the same no-op / logging / listener-dispatch
   * guards the production path uses. Preferred over poking
   * `linkStatus` directly. Not part of the public API.
   * @internal
   */
  setLinkStatusForTests(status: GraphQLLinkStatus): void {
    this.setLinkStatus(status)
  }

  private handleConnecting(reconnecting: boolean): void {
    if (!reconnecting) return
    this.reconnectingSince ??= this.now()
    const elapsed = this.now() - this.reconnectingSince
    if (elapsed >= FAILED_AFTER_RECONNECTING_MS) {
      this.setLinkStatus('failed')
    } else {
      this.setLinkStatus('reconnecting')
    }
  }

  private handleConnected(reconnected: boolean): void {
    this.reconnectingSince = null
    this.setLinkStatus('ok')
    if (reconnected) {
      logger.info('[GraphQLClient] Subscription link recovered')
    }
  }

  private setLinkStatus(next: GraphQLLinkStatus): void {
    if (this.linkStatus === next) return
    this.linkStatus = next
    if (next === 'reconnecting') {
      logger.warn('[GraphQLClient] Subscription link reconnecting')
    } else if (next === 'failed') {
      logger.error('[GraphQLClient] Subscription link still down after repeated retries', {
        reconnectingForMs: this.reconnectingSince !== null ? this.now() - this.reconnectingSince : 0
      })
    }
    for (const listener of this.linkStatusListeners) {
      try {
        listener(next)
      } catch (error) {
        logger.warn('[GraphQLClient] Link-status listener threw', { error: String(error) })
      }
    }
  }

  private async waitForBackoff(retries: number): Promise<void> {
    const delay = computeBackoffDelay(retries, this.random)
    await new Promise<void>((resolve) => setTimeout(resolve, delay))
  }
}

/** Singleton instance */
export const graphQLClient = new GraphQLClient()
