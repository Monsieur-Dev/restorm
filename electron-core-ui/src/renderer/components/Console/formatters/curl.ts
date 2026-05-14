import type { ConsoleRecord, RecordRenderer } from '../types'
import { shellSingleQuote } from './shellEscape'

/**
 * Pretty-print a body for display in the console. JSON bodies get
 * indented (so `{"query":"…","variables":{…}}` reads as a multi-line
 * structure instead of a single escaped wall); anything that doesn't
 * parse as JSON is returned unchanged. Only the visual form changes
 * — the resulting string is still valid JSON because shell single-
 * quotes preserve every character literally, including the inserted
 * newlines + spaces.
 *
 * `\n` escapes *inside* JSON string values (e.g. the GraphQL
 * `query` field) are intentionally left as-is — unescaping them
 * would produce a raw LF inside a JSON string, which the spec
 * rejects and many servers refuse.
 */
function prettyBody(body: string): string {
  const trimmed = body.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return body
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return body
  }
}

/**
 * Render an HTTP-family record (HTTP / HTTPS / GraphQL / SOAP /
 * OData) as a `curl` command line. One header per `-H` flag, body
 * via `--data-raw` for safe verbatim quoting; binary placeholders
 * fall through unchanged so the user sees what was suppressed.
 */
const renderHttpCurl: RecordRenderer = (record: ConsoleRecord): string => {
  const lines: string[] = []
  lines.push(`curl -X ${record.method} ${shellSingleQuote(record.url)} \\`)
  for (const [k, v] of Object.entries(record.headers)) {
    lines.push(`  -H ${shellSingleQuote(`${k}: ${v}`)} \\`)
  }
  if (record.body !== undefined && record.body.length > 0) {
    lines.push(`  --data-raw ${shellSingleQuote(prettyBody(record.body))} \\`)
  }
  // Drop the trailing backslash on the last line for a clean copy.
  const last = lines[lines.length - 1]
  if (last !== undefined) {
    lines[lines.length - 1] = last.replace(/ \\$/, '')
  }
  return lines.join('\n')
}

/**
 * gRPC: `grpcurl -d '<json>' -plaintext host:port pkg.Service/Method`.
 * The `method` field on a gRPC record carries the fully-qualified RPC
 * (e.g. `pet.PetStore/GetPet`); the body is the JSON payload (or
 * empty for unary calls without input).
 */
const renderGrpcCurl: RecordRenderer = (record: ConsoleRecord): string => {
  const target = `${record.host}:${String(record.port)}`
  const tlsFlag = record.protocol === 'grpc' ? '-plaintext' : ''
  const dataFlag = record.body !== undefined && record.body.length > 0
    ? `-d ${shellSingleQuote(record.body)} `
    : ''
  const headerFlags = Object.entries(record.headers)
    .map(([k, v]) => `-H ${shellSingleQuote(`${k}: ${v}`)}`)
    .join(' ')
  const parts = ['grpcurl']
  if (tlsFlag) parts.push(tlsFlag)
  if (headerFlags) parts.push(headerFlags)
  if (dataFlag) parts.push(dataFlag.trim())
  parts.push(shellSingleQuote(target))
  parts.push(shellSingleQuote(record.method))
  return parts.join(' ')
}

/**
 * WebSocket: `wscat -c <url>` for the connection. Headers are
 * appended via `-H`; body / frames are not directly representable
 * in a single command, so the renderer just shows the connect call
 * with a `# frames sent at runtime` comment for honesty.
 */
const renderWebSocketCurl: RecordRenderer = (record: ConsoleRecord): string => {
  const lines: string[] = []
  const headerFlags = Object.entries(record.headers)
    .map(([k, v]) => `-H ${shellSingleQuote(`${k}: ${v}`)}`)
    .join(' ')
  lines.push(`wscat -c ${shellSingleQuote(record.url)}${headerFlags ? ' ' + headerFlags : ''}`)
  if (record.body !== undefined && record.body.length > 0) {
    lines.push(`# Initial frame: ${record.body.split('\n').join(' ')}`.slice(0, 200))
  }
  return lines.join('\n')
}

/**
 * Dispatcher: pick the right curl-family renderer based on the
 * record's `protocol`. The HTTP family (HTTP / HTTPS / GraphQL /
 * SOAP / OData) all serialise the same way — they only differ in
 * what the user puts in the body.
 */
export const renderCurl: RecordRenderer = (record: ConsoleRecord): string => {
  switch (record.protocol) {
    case 'grpc': return renderGrpcCurl(record)
    case 'websocket': return renderWebSocketCurl(record)
    default:
      return renderHttpCurl(record)
  }
}
