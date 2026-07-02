import type { BaseRequest } from './BaseRequest'
import type { KeyValue } from '../baseTypes'

/** A Server-Sent Events (`text/event-stream`) request — a dedicated,
 * receive-only streaming type (no send direction, unlike WebSocket). The
 * execution service opens a streaming HTTP GET and parses `event:` / `data:` /
 * `id:` / `retry:` frames per the W3C EventSource spec, reconnecting with
 * `Last-Event-ID` when the connection drops. */
export interface SseRequest extends BaseRequest {
  type: 'sse'
  url: string
  headers: KeyValue[]
  /** Seed value for the `Last-Event-ID` header on the FIRST connect (a
   * reconnect after that uses the last `id:` actually received). Optional —
   * most streams start with no prior id. */
  lastEventId?: string | undefined
}
