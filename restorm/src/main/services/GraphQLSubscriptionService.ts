/**
 * GraphQL Subscription Service
 *
 * Consumes a GraphQL **subscription** as a CLIENT over Server-Sent Events (the
 * "GraphQL over SSE" / `graphql-sse` protocol that graphql-yoga serves). This is
 * the streaming counterpart to {@link GraphQLExecutionService}, which only does
 * one-shot query/mutation request/response: a subscription is a long-lived
 * connection that pushes a stream of payloads until it completes, errors, or the
 * caller unsubscribes.
 *
 * The streaming surface mirrors `GRPCExecutionService` / `WebSocketExecutionService`:
 * `connectStreaming` opens the subscription behind the Subscribe button and
 * streams its lifecycle through `onConnect` / `onMessage` / `onClose`, broadcasting
 * `graphql-sub:progress` (lifecycle) + `graphql-sub:event` (each pushed payload) to
 * the renderer. Subscriptions are RECEIVE-ONLY, so there is no `send` — only
 * `unsubscribe` / `isActive`.
 */

import { URL } from 'url'
import { BrowserWindow } from 'electron'
import { createClient } from 'graphql-sse'
import { logger } from 'electron-core-ui/main'
import { contextService } from './ContextService'
import { attachSessionCookies } from './cookieRequestHelpers'
import { secretHydrationService } from './secrets/SecretHydrationService'
import { collectRequestSecrets } from './secrets/collectRequestSecrets'
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../../shared/config/constants'

/** A single payload pushed by the subscription, in arrival order. */
export interface GraphQLSubscriptionEvent {
  /** JSON-serialised `{ data?, errors? }` GraphQL execution result. */
  data: string
  /** ISO timestamp the event was received. */
  timestamp: string
}

/** Lifecycle status broadcast to the renderer for the listening badge + UI. */
export type GraphQLSubscriptionStatus = 'started' | 'completed' | 'cancelled' | 'error'

/** A live subscription the user can stream from + later unsubscribe. */
interface ActiveSubscription {
  requestId: string
  /** The graphql-sse dispose handle — invoking it tears the SSE stream down. */
  dispose: () => void
  /** Drive the single terminal broadcast + `onClose`. Idempotent (guarded by an
   * internal `fired` flag), so a later `complete` from graphql-sse is a no-op. */
  fireClose: (error?: string) => void
  /** Mark this subscription as ended by the caller (Stop button / scenario
   * close) so {@link fireClose} reports `cancelled` rather than `completed`. */
  markClosedByCaller: () => void
}

/**
 * Resolve the endpoint URL, headers, query, variables, and operationName for a
 * GraphQL subscription request from the shared request context — reusing the same
 * resolution {@link GraphQLExecutionService} performs (resolved URL + secret
 * hydration + type-aware header substitution).
 */
interface ResolvedSubscription {
  url: string
  headers: Record<string, string>
  query: string
  variables?: Record<string, unknown>
  operationName?: string
}

/**
 * Parse the subscription operation out of a serialised GraphQL request body. The
 * request panel stores the body as a JSON string with `query` / `variables`
 * (`variables` itself a JSON STRING), so coerce `variables` to an object and drop
 * it when empty. Falls back to the discrete `query` / `variables` fields.
 */
export function extractOperation(
  bodyString: string | undefined,
  fallbackQuery: string,
  fallbackVariables: string
): { query: string; variables?: Record<string, unknown>; operationName?: string } {
  const coerceVariables = (raw: unknown): Record<string, unknown> | undefined => {
    let v = raw
    if (typeof v === 'string') {
      try {
        v = JSON.parse(v)
      } catch {
        return undefined
      }
    }
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0) {
      return v as Record<string, unknown>
    }
    return undefined
  }

  if (bodyString !== undefined && bodyString.trim() !== '') {
    try {
      const raw: unknown = JSON.parse(bodyString)
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const parsed = raw as { query?: unknown; variables?: unknown; operationName?: unknown }
        const variables = coerceVariables(parsed.variables)
        return {
          query: typeof parsed.query === 'string' ? parsed.query : fallbackQuery,
          ...(variables ? { variables } : {}),
          ...(typeof parsed.operationName === 'string' ? { operationName: parsed.operationName } : {})
        }
      }
    } catch {
      // Not a JSON envelope — treat the raw body as the query text below.
    }
    return { query: bodyString }
  }

  const variables = coerceVariables(fallbackVariables)
  return { query: fallbackQuery, ...(variables ? { variables } : {}) }
}

/** Best-effort human-readable message for a graphql-sse `error` sink payload. */
export function subscriptionErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (Array.isArray(err)) {
    // A GraphQL `errors` array from the server.
    const messages = err
      .map((e) => (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : ''))
      .filter((m) => m !== '')
    if (messages.length > 0) return messages.join('; ')
  }
  if (err && typeof err === 'object') {
    try {
      return JSON.stringify(err)
    } catch {
      return 'Subscription error'
    }
  }
  return typeof err === 'string' && err !== '' ? err : 'Subscription error'
}

/**
 * Service for consuming GraphQL subscriptions over SSE in the main process.
 */
class GraphQLSubscriptionService {
  private active = new Map<string, ActiveSubscription>()

  /**
   * Open a long-lived GraphQL subscription over SSE. Streams its lifecycle
   * through the callbacks: `onConnect` once the SSE stream is established,
   * `onMessage(payload)` for every pushed `next` event, `onClose(error?)` once
   * the stream completes / errors / is unsubscribed. Registers the subscription
   * so `unsubscribe` / `isActive` / the UI badge beam work, and returns a handle.
   *
   * Frames + lifecycle ALSO reach the renderer via the `graphql-sub:event` /
   * `graphql-sub:progress` broadcasts this method fires internally, so an IPC
   * caller can pass no-op callbacks.
   */
  connectStreaming(input: {
    requestId: string
    onConnect: () => void
    onMessage: (payload: unknown) => void
    onClose: (error?: string) => void
    timeout?: number
  }): { close: () => void; isOpen: () => boolean } {
    const { requestId } = input
    const ctl = { closedByCaller: false, connected: false, fired: false }

    const fireClose = (error?: string): void => {
      if (ctl.fired) return
      ctl.fired = true
      this.active.delete(requestId)
      if (ctl.closedByCaller) {
        this.broadcastProgress(requestId, 'cancelled')
      } else if (error !== undefined) {
        this.broadcastProgress(requestId, 'error')
      } else {
        this.broadcastProgress(requestId, 'completed')
      }
      input.onClose(error)
    }

    void (async () => {
      let resolved: ResolvedSubscription
      try {
        resolved = await this.resolveSubscription(requestId, input.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS)
      } catch (err) {
        fireClose((err as Error).message)
        return
      }
      if (ctl.closedByCaller) {
        fireClose()
        return
      }

      logger.info('[GraphQLSubscriptionService] Subscribing', { requestId, url: resolved.url })
      this.broadcastProgress(requestId, 'started')

      // Attach the environment jar's cookies to the subscribe request (auth on
      // subscribe). graphql-sse's default fetch does not surface the response to
      // us, so Set-Cookie on the SSE stream is not captured here — attach only.
      attachSessionCookies(requestId, resolved.url, resolved.headers)

      // Distinct-connections mode (the graphql-yoga default): one SSE connection
      // per subscribe, on the same GraphQL endpoint URL. Electron's main process
      // (Node 20+) provides global `fetch` + `AbortController`, so graphql-sse's
      // `fetchFn` / `abortControllerImpl` are left at their defaults.
      const client = createClient({
        url: resolved.url,
        singleConnection: false,
        ...(Object.keys(resolved.headers).length > 0 ? { headers: resolved.headers } : {}),
        retryAttempts: 0
      })

      let firstEvent = true
      const dispose = client.subscribe(
        {
          query: resolved.query,
          ...(resolved.variables ? { variables: resolved.variables } : {}),
          ...(resolved.operationName ? { operationName: resolved.operationName } : {})
        },
        {
          next: (payload) => {
            // The SSE stream is live the moment the first event lands; surface
            // `connected` exactly once so the badge beam lights up.
            if (firstEvent) {
              firstEvent = false
              ctl.connected = true
              input.onConnect()
            }
            const event: GraphQLSubscriptionEvent = {
              data: JSON.stringify(payload),
              timestamp: new Date().toISOString()
            }
            this.broadcastEvent(requestId, event)
            input.onMessage(payload)
          },
          // `error` / `complete` are terminal; `fireClose` owns the single
          // lifecycle broadcast (error vs cancelled vs completed), so neither
          // callback broadcasts directly — that would double-emit.
          error: (err) => {
            fireClose(subscriptionErrorMessage(err))
          },
          complete: () => {
            fireClose()
          }
        }
      )

      // A Stop that arrived DURING resolution is handled by the early-return
      // guard above (before `createClient`); from here on the subscription is
      // live and `unsubscribe` tears it down.
      this.active.set(requestId, {
        requestId,
        dispose,
        fireClose,
        markClosedByCaller: () => { ctl.closedByCaller = true }
      })
    })()

    return {
      close: () => {
        ctl.closedByCaller = true
        this.unsubscribe(requestId)
      },
      isOpen: () => this.active.has(requestId)
    }
  }

  /**
   * Unsubscribe an active subscription (the Stop / Unsubscribe control). Tears
   * the SSE stream down via the graphql-sse dispose handle; the `complete`
   * callback fires `onClose`. Returns `false` when no subscription is active.
   */
  unsubscribe(requestId: string): boolean {
    const sub = this.active.get(requestId)
    if (!sub) return false
    logger.info('[GraphQLSubscriptionService] Unsubscribing', { requestId })
    // Flag the cancellation BEFORE tearing down so the single terminal broadcast
    // reports `cancelled`. `fireClose` is idempotent, so the `complete` callback
    // graphql-sse may fire on dispose is a harmless no-op.
    sub.markClosedByCaller()
    try {
      sub.dispose()
    } catch {
      // graphql-sse swallows its own teardown errors; ignore.
    }
    sub.fireClose()
    return true
  }

  /** Whether a subscription is currently streaming for this request. */
  isActive(requestId: string): boolean {
    return this.active.has(requestId)
  }

  /**
   * Resolve the endpoint, headers, and operation for a subscription request,
   * hydrating any secrets reachable from the request + its env-folder chain
   * first (mirrors {@link GraphQLExecutionService.execute}).
   */
  private async resolveSubscription(requestId: string, timeout: number): Promise<ResolvedSubscription> {
    const urlResult = contextService.getResolvedUrl(requestId)
    if (!urlResult) {
      throw new Error('No resolved URL found for this request. Make sure the request is registered.')
    }
    const requestContext = contextService.getRequestContext(requestId)

    // Resolve SecretValues reachable from this request's KeyValue groups AND the
    // active env-folder variable chain before reading the URL/headers.
    const abortController = new AbortController()
    const envSecrets = contextService.collectEnvironmentSecrets(requestId)
    const secrets = [...collectRequestSecrets(requestContext?.keyValueGroups), ...envSecrets]
    let effectiveUrl = urlResult.resolvedUrl
    if (secrets.length > 0) {
      const timer = setTimeout(() => { abortController.abort() }, timeout)
      try {
        await secretHydrationService.hydrate(requestId, secrets, abortController.signal)
      } finally {
        clearTimeout(timer)
      }
      if (envSecrets.length > 0) {
        contextService.refreshEnvironmentContext(requestId)
        effectiveUrl = contextService.getResolvedUrl(requestId)?.resolvedUrl ?? effectiveUrl
      }
    }

    // Validate the URL early so a bad endpoint surfaces as a clean error.
    try {
      void new URL(effectiveUrl).href
    } catch {
      throw new Error(`Invalid URL: ${effectiveUrl}`)
    }

    const headers: Record<string, string> = {}
    const headersGroup = requestContext?.keyValueGroups.get('headers')
    if (headersGroup) {
      for (const h of headersGroup) {
        if (h.enabled === false) continue
        if (h.key) {
          // The KEY resolves unconditionally through Handlebars, same as a
          // path/query param key or the URL — see `HTTPExecutionService`.
          // The VALUE stays type-aware: only ExpressionValue rows get
          // handlebars-substituted; a StringValue row ships verbatim.
          const resolvedKey = contextService.resolveValue(h.key, requestId)
          // An unknown variable resolves to '' — an empty header name is an
          // invalid HTTP token. Skip the row rather than throw.
          if (!resolvedKey) continue
          headers[resolvedKey] = contextService.resolveKeyValueForRequest(h, requestId)
        }
      }
    }

    const fullData = requestContext?.fullData as
      | { body?: unknown; query?: string; variables?: string }
      | undefined
    const fullBody = fullData?.body
    const bodyString =
      typeof fullBody === 'string'
        ? fullBody
        : fullBody && typeof fullBody === 'object' && typeof (fullBody as { content?: unknown }).content === 'string'
          ? (fullBody as { content: string }).content
          : undefined
    const resolvedBody = bodyString !== undefined ? contextService.resolveValue(bodyString, requestId) : undefined

    const operation = extractOperation(resolvedBody, fullData?.query ?? '', fullData?.variables ?? '{}')
    if (operation.query.trim() === '') {
      throw new Error('No GraphQL subscription operation to run.')
    }

    return {
      url: effectiveUrl,
      headers,
      query: operation.query,
      ...(operation.variables ? { variables: operation.variables } : {}),
      ...(operation.operationName ? { operationName: operation.operationName } : {})
    }
  }

  /** Broadcast a lifecycle status to every renderer window. */
  private broadcastProgress(requestId: string, status: GraphQLSubscriptionStatus): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('graphql-sub:progress', { requestId, status })
    }
  }

  /** Broadcast one pushed subscription payload to every renderer window. */
  private broadcastEvent(requestId: string, event: GraphQLSubscriptionEvent): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('graphql-sub:event', { requestId, event })
    }
  }
}

/** Singleton instance */
export const graphqlSubscriptionService = new GraphQLSubscriptionService()
