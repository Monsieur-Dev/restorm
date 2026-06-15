/**
 * Pure helper for the scenario `socketioConnect` inspector preview / JSON-path
 * picker: pick a representative RECEIVED message from a connection's history and
 * parse it into the value a downstream `event:<name>` / `others` edge sees.
 *
 * Lives in `shared` (no main-process deps) so it unit-tests in isolation; the
 * MCP preview resolver in `scenarioRun.ts` reads the request's WebSocket history
 * and feeds the frames here.
 */

/** A stored WebSocket/Socket.IO frame (the subset this helper needs). */
export interface SocketioHistoryFrame {
  direction: string
  data: string
  event?: string
}

/**
 * The representative received-message data for a `socketioConnect` preview: the
 * most recent received frame on a LISTENED event (falls back to the latest
 * received frame of any event), parsed from the wire string. A picker tree needs
 * an object/array, so a bare primitive is wrapped as `{ value }` — mirroring how
 * a scalar HTTP response would surface. Returns null when there are no received
 * frames at all.
 */
export function socketioPreviewFromMessages(
  messages: readonly SocketioHistoryFrame[],
  events: readonly string[]
): Record<string, unknown> | null {
  const received = messages.filter((m) => m.direction === 'received')
  if (received.length === 0) return null
  const onListened = [...received].reverse().find((m) => typeof m.event === 'string' && events.includes(m.event))
  const pick = onListened ?? received[received.length - 1]
  if (!pick) return null
  let data: unknown
  try { data = JSON.parse(pick.data) } catch { data = pick.data }
  return data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : { value: data }
}
