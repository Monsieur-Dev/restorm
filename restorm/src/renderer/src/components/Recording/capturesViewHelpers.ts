import type { RecordedCallSummary } from '../../../../shared/types/recordingCapture'
import { httpBadgeIdFor } from '../../../../shared/utils/httpMethod'

/** `http://host/api/pets?x=1` → `/api/pets?x=1`; the operation for GraphQL, the method for gRPC. */
export function captureRouteLabel(capture: RecordedCallSummary): string {
  if (capture.protocol === 'graphql') {
    const op = capture.graphql
    return op?.operationName ?? (op ? op.operationType : capture.url)
  }
  if (capture.protocol === 'grpc-web' && capture.grpc) return `${capture.grpc.service}/${capture.grpc.method}`
  try {
    const url = new URL(capture.url)
    return `${url.pathname}${url.search}`
  } catch {
    return capture.url
  }
}

/** The registry badge of a captured call's protocol / method. */
export function captureBadgeId(capture: RecordedCallSummary): string {
  switch (capture.protocol) {
    case 'graphql': return 'gql'
    case 'grpc-web': return 'grpc'
    case 'websocket': return 'ws'
    default: return httpBadgeIdFor(capture.method)
  }
}

export const runRowId = (runId: string): string => `recording-run:${runId}`

export const isRunRowId = (id: string): boolean => id.startsWith('recording-run:')

/** A captured url as an exact-match pattern (the user edits it down). */
export function escapeForRegex(url: string): string {
  return `^${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`
}
