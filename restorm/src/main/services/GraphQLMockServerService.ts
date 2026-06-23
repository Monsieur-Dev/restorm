/**
 * GraphQL Mock Server Service
 *
 * Hosts a USER-CONFIGURED local GraphQL endpoint: restorm ACTS AS a GraphQL
 * server, resolving queries / mutations / subscriptions from a request's SDL
 * schema + canned (saved-example) and/or scripted resolvers, with introspection
 * on. The endpoint is a graphql-yoga `(req, res)` Node handler mounted on the
 * SHARED per-port HTTP request-dispatcher in {@link WebSocketExecutionService}
 * (one OS socket per port across protocols), exactly like the HTTP mock server.
 *
 * This is DISTINCT from the singleton `graphQLService` (electron-core-ui) /
 * `GraphQLSetup` — that is restorm's OWN internal renderer↔main data bridge (one
 * instance, fixed app schema, its own ephemeral server). This service is a
 * multi-instance, user-config-driven concern and never touches the bridge.
 */

import type { IncomingMessage, ServerResponse } from 'http'
import { Readable } from 'node:stream'
import { BrowserWindow } from 'electron'
import { createYoga, createPubSub, logger } from 'electron-core-ui/main'
import type { PubSub } from 'electron-core-ui/main'
import { contextService } from './ContextService'
import { websocketExecutionService } from './WebSocketExecutionService'
import { buildMockSchema } from './graphqlMockSchema'

/** One served GraphQL operation, surfaced on a scenario `graphqlListen` node's
 * `served` output (shape mirrors the HTTP mock's `{ request, response }` so a
 * JSON-path picker drills it the same way). */
interface ServedSummary {
  request: { method: string; url: string; headers: Record<string, string>; body: string }
  response: { status: number; body: string }
}

/** Flatten Node's `IncomingHttpHeaders` to a plain string map. */
function flattenIncomingHeaders(headers: IncomingMessage['headers']): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) continue
    out[k] = Array.isArray(v) ? v.join(', ') : v
  }
  return out
}

class GraphQLMockServerService {
  /** Per-request served-operation counter for the "served N" banner. */
  private servedCounts = new Map<string, number>()
  /** Per-request PubSub, created lazily for schemas that declare subscriptions
   * so a scripted resolver can `publish` to a subscription topic. */
  private pubsubs = new Map<string, PubSub<Record<string, [unknown]>>>()

  /**
   * SERVER MODE: start hosting this request as a local GraphQL mock. restorm
   * LISTENS on `localhost:<port><path>` and answers GraphQL operations from the
   * configured schema + resolvers until {@link stopListening}. Registers BOTH
   * POST (operations) and GET (GraphiQL / introspection landing) on the shared
   * port; the second register reuses the same Yoga handler.
   */
  async listen(requestId: string): Promise<{ success: boolean; listening: boolean; error?: string }> {
    const fullData = contextService.getRequestContext(requestId)?.fullData
    const { port, path } = this.parseMockAddress(fullData?.url ?? '')
    if (!Number.isFinite(port) || port <= 0) {
      return { success: false, listening: false, error: 'A valid localhost port is required for a GraphQL mock server' }
    }

    this.broadcastProgress(requestId, 'started')
    this.servedCounts.set(requestId, 0)

    const yoga = this.buildYogaHandler(requestId, path)
    const result = await websocketExecutionService.listenHttpServer({
      requestId,
      method: 'POST',
      port,
      path,
      onRequest: (req, res) => { void this.serve(requestId, yoga, req, res) },
      onStopped: (error) => {
        this.servedCounts.delete(requestId)
        this.pubsubs.delete(requestId)
        this.broadcastProgress(requestId, error ? 'error' : 'completed')
      }
    })

    if (!result.listening) {
      this.servedCounts.delete(requestId)
      this.pubsubs.delete(requestId)
      this.broadcastProgress(requestId, 'error')
    }
    return result
  }

  /**
   * SCENARIO server node ({@link graphqlListenExecutor}): HOST this request's
   * GraphQL mock as a LONG-LIVED listener and bridge it to the scheduler's
   * connect machinery. `connect` = listen, each served operation re-emits via
   * `onMessage` (→ the `served` port), `close` = stop the server (→ `done`).
   * Mirrors {@link HTTPExecutionService.connectStreamingHttpServer}.
   */
  connectStreamingGraphqlServer(input: {
    requestId: string
    onConnect: () => void
    onMessage: (event: string | undefined, payload: unknown) => void
    onClose: (error?: string) => void
  }): { send: (channel: string, payload: string) => boolean; close: () => void; isOpen: () => boolean } {
    const { requestId } = input
    const fullData = contextService.getRequestContext(requestId)?.fullData
    const { port, path } = this.parseMockAddress(fullData?.url ?? '')
    let fired = false
    const fireClose = (error?: string): void => {
      if (fired) return
      fired = true
      this.servedCounts.delete(requestId)
      this.pubsubs.delete(requestId)
      this.broadcastProgress(requestId, error ? 'error' : 'completed')
      input.onClose(error)
    }

    if (!Number.isFinite(port) || port <= 0) {
      queueMicrotask(() => { fireClose('A valid localhost port is required for a GraphQL mock server') })
      return { send: () => false, close: () => { fireClose() }, isOpen: () => false }
    }

    this.broadcastProgress(requestId, 'started')
    this.servedCounts.set(requestId, 0)

    const yoga = this.buildYogaHandler(requestId, path)
    void websocketExecutionService.listenHttpServer({
      requestId,
      method: 'POST',
      port,
      path,
      onRequest: (req, res) => {
        void this.serve(requestId, yoga, req, res).then((summary) => {
          if (summary) input.onMessage(undefined, summary)
        })
      },
      onStopped: (error) => { fireClose(error) }
    }).then((result) => {
      if (result.listening) input.onConnect()
      else fireClose(result.error ?? `failed to start GraphQL mock server for ${requestId}`)
    }).catch((err: unknown) => { fireClose(err instanceof Error ? err.message : String(err)) })

    return {
      // A hosted GraphQL mock never SENDS unprompted — it only answers inbound
      // operations — so `send` is a no-op (there is no graphqlSend node).
      send: () => false,
      close: () => { this.stopListening(requestId) },
      isOpen: () => this.isListening(requestId)
    }
  }

  /** Stop hosting this request's GraphQL mock route (the Stop button). Frees the
   * shared port once it was the last route. Idempotent. */
  stopListening(requestId: string): boolean {
    this.servedCounts.delete(requestId)
    this.pubsubs.delete(requestId)
    return websocketExecutionService.disconnect(requestId)
  }

  /** Whether this request is currently hosting a GraphQL mock route. */
  isListening(requestId: string): boolean {
    return websocketExecutionService.isActive(requestId)
  }

  /**
   * Build the graphql-yoga `(req, res)` handler from the request's SDL +
   * resolvers. Introspection is ON (Yoga default); the landing page is enabled
   * so a browser GET renders GraphiQL. `graphqlEndpoint` is set to the route's
   * own path so Yoga accepts requests dispatched to that path verbatim.
   */
  private buildYogaHandler(requestId: string, path: string): ReturnType<typeof createYoga> {
    const fullData = contextService.getRequestContext(requestId)?.fullData as
      | { schema?: string; mockResolvers?: string; resolverScript?: string }
      | undefined
    const schema = buildMockSchema({
      ...(fullData?.schema !== undefined ? { schema: fullData.schema } : {}),
      ...(fullData?.mockResolvers !== undefined ? { mockResolvers: fullData.mockResolvers } : {}),
      ...(fullData?.resolverScript !== undefined ? { resolverScript: fullData.resolverScript } : {}),
      pubsub: this.getPubSub(requestId)
    })
    return createYoga({
      schema,
      graphqlEndpoint: path,
      // Browser GETs land on GraphiQL; introspection stays on for programmatic
      // clients either way (graphql-yoga default).
      landingPage: false,
      logging: {
        // Yoga's debug/info chatter is dropped; only warn/error reach the logger.
        debug: () => { /* dropped */ },
        info: () => { /* dropped */ },
        warn: (...args: unknown[]) => { logger.warn('[GraphQLMockServer]', { args }) },
        error: (...args: unknown[]) => { logger.error('[GraphQLMockServer]', { args }) }
      }
    })
  }

  /** Lazily mint a per-request PubSub for subscription resolvers. */
  private getPubSub(requestId: string): PubSub<Record<string, [unknown]>> {
    let pubsub = this.pubsubs.get(requestId)
    if (!pubsub) {
      pubsub = createPubSub<Record<string, [unknown]>>()
      this.pubsubs.set(requestId, pubsub)
    }
    return pubsub
  }

  /**
   * Run one inbound request through the Yoga handler, record the hit + bump the
   * served count, and return a served summary for the scenario `served` port.
   * The request body is buffered so it can be both fed to Yoga AND surfaced on
   * the summary.
   */
  private async serve(
    requestId: string,
    yoga: ReturnType<typeof createYoga>,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<ServedSummary | undefined> {
    const reqBody = await this.readBody(req)
    // Re-feed the buffered body to Yoga: Node's request stream is single-read,
    // so wrap it in a fresh readable carrying the captured bytes.
    const yogaReq = this.withReplayBody(req, reqBody)

    // Capture the response body written by Yoga for the served summary.
    let captured = ''
    const origWrite = res.write.bind(res)
    const origEnd = res.end.bind(res)
    res.write = ((chunk: unknown, ...rest: unknown[]): boolean => {
      if (typeof chunk === 'string') captured += chunk
      else if (Buffer.isBuffer(chunk)) captured += chunk.toString('utf8')
      return (origWrite as (...a: unknown[]) => boolean)(chunk, ...rest)
    }) as typeof res.write
    res.end = ((chunk?: unknown, ...rest: unknown[]): ServerResponse => {
      if (typeof chunk === 'string') captured += chunk
      else if (Buffer.isBuffer(chunk)) captured += chunk.toString('utf8')
      return (origEnd as (...a: unknown[]) => ServerResponse)(chunk, ...rest)
    }) as typeof res.end

    await yoga(yogaReq, res)

    const served = (this.servedCounts.get(requestId) ?? 0) + 1
    this.servedCounts.set(requestId, served)
    this.broadcastServed(requestId, served)
    logger.info('[GraphQLMockServer] operation served', { requestId, served })
    return {
      request: { method: req.method ?? '', url: req.url ?? '', headers: flattenIncomingHeaders(req.headers), body: reqBody },
      response: { status: res.statusCode, body: captured }
    }
  }

  /** Buffer the request body (bounded) so it can be replayed to Yoga AND echoed
   * on the served summary. */
  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = []
      let size = 0
      const MAX = 5 * 1024 * 1024
      req.on('data', (c: Buffer) => {
        size += c.length
        if (size <= MAX) chunks.push(c)
      })
      req.on('end', () => { resolve(Buffer.concat(chunks).toString('utf8')) })
      req.on('error', () => { resolve(Buffer.concat(chunks).toString('utf8')) })
    })
  }

  /** Wrap an already-consumed request in a fresh readable carrying the captured
   * body so Yoga can read it. Method / url / headers are preserved by reference. */
  private withReplayBody(req: IncomingMessage, body: string): IncomingMessage {
    const replay = Readable.from([Buffer.from(body, 'utf8')]) as unknown as IncomingMessage
    replay.method = req.method
    replay.url = req.url
    replay.headers = req.headers
    return replay
  }

  /** Split a mock address (`localhost:<port><path>`) into numeric port + path
   * (default `/graphql`, query dropped). Mirrors the HTTP mock's parser. */
  private parseMockAddress(raw: string): { port: number; path: string } {
    const stripped = raw.replace(/^[a-z]+:\/\//i, '')
    const slash = stripped.indexOf('/')
    const authority = slash >= 0 ? stripped.slice(0, slash) : stripped
    let path = slash >= 0 ? stripped.slice(slash) : '/graphql'
    const q = path.indexOf('?')
    if (q >= 0) path = path.slice(0, q)
    if (path.length === 0 || path === '/') path = '/graphql'
    const colon = authority.lastIndexOf(':')
    const port = colon >= 0 ? Number.parseInt(authority.slice(colon + 1), 10) : NaN
    return { port, path }
  }

  /** Broadcast the served-operation count — the request panel shows "served N". */
  private broadcastServed(requestId: string, count: number): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('graphql:server-served', { requestId, count })
    }
  }

  /** Broadcast server progress on the GraphQL channel (drives the Listen↔Stop
   * toggle + the listening beam). */
  private broadcastProgress(requestId: string, status: 'started' | 'completed' | 'cancelled' | 'error'): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('graphql:request-progress', { requestId, status })
    }
  }
}

/** Singleton instance */
export const graphqlMockServerService = new GraphQLMockServerService()
