/**
 * Input contract for the Console panel. A consuming app feeds the
 * panel an array of `ConsoleRecord` — typically intercepted network
 * traffic from a firewall / proxy layer. The fields are intentionally
 * a minimal, widened shape: any app-specific record type (e.g.
 * the host's `RequestRecord`) that carries these fields structurally
 * satisfies `ConsoleRecord` with no conversion.
 *
 * The optional fields use `?:` (property may be absent) rather than
 * `| undefined` — under `exactOptionalPropertyTypes` a consumer record
 * must keep its matching fields `?:`-style for structural assignment
 * to hold.
 */
export interface ConsoleRecord {
  /** Stable identifier. Updates to an existing record (e.g. patching
   * in a status / duration on completion) are keyed by this id. */
  id: string
  /** ISO-8601 capture timestamp. */
  timestamp: string
  /** HTTP method (or pseudo-method for non-HTTP protocols). */
  method: string
  /** Full request URL. */
  url: string
  /** Hostname / IP literal. */
  host: string
  /** Numeric port. */
  port: number
  /** Request headers, as a flat string map. */
  headers: Record<string, string>
  /** Request body, when present. */
  body?: string
  /** Wire-protocol category — drives which shell-command renderer is
   * picked (`http`/`https`/`graphql`/`soap`/`odata` → curl-family,
   * `grpc` → grpcurl, `websocket` → wscat). Widened to `string` so
   * any app's protocol enum satisfies it. */
  protocol: string
  /** Latest known verdict for the record. */
  verdict: 'allow' | 'deny' | 'pending'
  /** Response status, set on the completion patch. */
  status?: number
  /** Total duration in ms, set on the completion patch. */
  durationMs?: number
  /** Error detail, set on the completion patch when the call failed. */
  errorMessage?: string
}

/**
 * Shell flavour the user picked from the console toolbar. Drives
 * which renderer is selected for each `ConsoleRecord`. The toggle
 * is global — flipping it re-renders the entire scrollback.
 */
export type ConsoleShell = 'curl' | 'powershell'

/**
 * One renderer per `(protocol × shell)` pair. Returns the multi-line
 * shell command the user can copy / replay; ANSI escape codes for
 * colourisation are added by the consumer (`Console.tsx`).
 */
export type RecordRenderer = (record: ConsoleRecord) => string
