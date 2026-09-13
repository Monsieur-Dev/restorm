/**
 * Runtime shapes of a recording session's captures.
 *
 * Captures live ONLY in the main process, for the life of the app: they
 * are never written to the project document nor mirrored wholesale to the
 * renderer. The renderer receives light {@link RecordedCallSummary} rows
 * (live, as calls happen) and asks for a {@link RecordedCallDetail} on
 * demand when a row is selected.
 */

import type { RecordingProtocol } from './recordingSession'

/** One press of the record button: the level-1 row of the Captures list. */
export interface RecordingRun {
  id: string
  sessionId: string
  /** The page url the run started on. */
  url: string
  startedAt: number
  /** `null` while the run is live. */
  endedAt: number | null
}

/** Chromium's resource type of the request, lower-cased. Kept so a later
 * view can filter "API calls" from page assets. */
export type CaptureResourceType =
  | 'document' | 'xhr' | 'fetch' | 'websocket' | 'eventsource' | 'ping' | 'other'
  | 'script' | 'stylesheet' | 'image' | 'font' | 'media' | 'manifest' | 'preflight' | 'unknown'

export interface CaptureHeader {
  key: string
  value: string
}

export interface CaptureBody {
  /** `utf8` text or `base64` for binary payloads. */
  encoding: 'utf8' | 'base64'
  data: string
  mimeType: string | null
  /** Decoded size in bytes. */
  size: number
}

export interface RecordedWebSocketFrame {
  direction: 'sent' | 'received'
  timestamp: number
  /** WebSocket opcode (1 text, 2 binary, 8 close, 9 ping, 10 pong). */
  opcode: number
  payload: string
}

/** The light row the renderer lists and the deduction works from. */
export interface RecordedCallSummary {
  id: string
  sessionId: string
  runId: string
  protocol: RecordingProtocol
  /** Epoch milliseconds of the request start. */
  timestamp: number
  /** HTTP verb (upper-case); `WS` for a WebSocket connection. */
  method: string
  url: string
  resourceType: CaptureResourceType
  /** Transport status when the response arrived. */
  status?: number
  statusText?: string
  durationMs?: number
  /** Response mime type, when known. */
  mimeType?: string
  /** Encoded response size in bytes, when known. */
  responseSize?: number
  /** Network error text when the call failed before a response. */
  error?: string
  graphql?: { operationType: 'query' | 'mutation' | 'subscription'; operationName: string | null }
  grpc?: { service: string; method: string }
  websocket?: {
    /** The discriminant of the first message when one was found. */
    messageType: string | null
    /** Every distinct discriminant observed on the connection. */
    messageTypes: string[]
    frameCount: number
    closed: boolean
  }
}

/** The full record, fetched on demand for the detail pane. */
export interface RecordedCallDetail extends RecordedCallSummary {
  request: {
    headers: CaptureHeader[]
    query: CaptureHeader[]
    body: CaptureBody | null
  }
  /** `null` until a response arrives (or when the call failed). */
  response: {
    headers: CaptureHeader[]
    body: CaptureBody | null
  } | null
  websocketFrames?: RecordedWebSocketFrame[]
}

/** What the capture engine filters on — the session's config, live. */
export interface RecordingFilterConfig {
  protocols: RecordingProtocol[]
  whitelist: string[]
  blacklist: string[]
}

export type RecordingState = 'idle' | 'recording' | 'paused'

export interface RecordingStatus {
  sessionId: string
  state: RecordingState
  /** The live run, when recording or paused. */
  runId: string | null
  /** The mini-browser tab the engine listens to, when recording. */
  tabId: string | null
  captureCount: number
}
