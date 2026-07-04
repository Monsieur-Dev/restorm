import type { BaseResponse, HTTPTimings } from './BaseResponse'

/** One parsed SSE frame (`event:`/`data:`/`id:` per the W3C EventSource spec). */
export interface SseFrame {
  event: string
  data: string
  id?: string | undefined
  timestamp: string
}

export interface SseResponse extends BaseResponse {
  type: 'sse'
  requestUrl: string
  connected: boolean
  frames: SseFrame[]
  timings: HTTPTimings
}
