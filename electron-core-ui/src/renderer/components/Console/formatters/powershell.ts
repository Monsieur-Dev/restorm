import type { ConsoleRecord, RecordRenderer } from '../types'
import { powershellSingleQuote } from './shellEscape'

/**
 * Pretty-print a JSON body so the console renders structure
 * across multiple lines instead of one escaped wall. Mirror of
 * `prettyBody` in `curl.ts` — kept inline rather than shared so
 * each formatter can evolve its own quirks (PowerShell's here-
 * string syntax for example) without coupling.
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
 * Build a PowerShell `$headers` hashtable literal for HTTP-family
 * records. PowerShell wants `@{ 'k' = 'v' }` syntax; the consumer
 * passes it via the `-Headers $headers` flag of `Invoke-RestMethod`.
 */
function buildHeadersTable(headers: Record<string, string>): string | null {
  const entries = Object.entries(headers)
  if (entries.length === 0) return null
  const lines = entries.map(([k, v]) =>
    `  ${powershellSingleQuote(k)} = ${powershellSingleQuote(v)}`
  )
  return `@{\n${lines.join('\n')}\n}`
}

/**
 * HTTP-family (HTTP / HTTPS / GraphQL / SOAP / OData):
 * `Invoke-RestMethod` is the idiomatic PowerShell tool. We emit a
 * variable-bindings preamble + a single multi-line invocation so
 * the user can paste-and-run.
 */
const renderHttpPowershell: RecordRenderer = (record: ConsoleRecord): string => {
  const lines: string[] = []
  const headersTable = buildHeadersTable(record.headers)
  if (headersTable !== null) lines.push(`$headers = ${headersTable}`)
  if (record.body !== undefined && record.body.length > 0) {
    lines.push(`$body = ${powershellSingleQuote(prettyBody(record.body))}`)
  }
  const flags = [
    `-Method ${record.method}`,
    `-Uri ${powershellSingleQuote(record.url)}`
  ]
  if (headersTable !== null) flags.push('-Headers $headers')
  if (record.body !== undefined && record.body.length > 0) flags.push('-Body $body')
  lines.push(`Invoke-RestMethod \`\n  ${flags.join(' \`\n  ')}`)
  return lines.join('\n')
}

/**
 * No native PowerShell equivalent for `grpcurl` / `wscat`. We
 * surface the curl-family command with a leading comment so the
 * user knows why they're seeing a Unix tool inside the PS pane —
 * still better than nothing because the command remains
 * copy-pasteable into WSL or Git Bash.
 */
function renderUnixToolFallback(command: string): string {
  const fallbackHint = '# No native PowerShell equivalent — reproducible Unix command:'
  return `${fallbackHint}\n${command}`
}

/**
 * gRPC PowerShell renderer. Falls back to `grpcurl` (Unix) with a
 * comment header. We rebuild the command rather than importing the
 * curl-family one to keep the formatters tree free of cross-shell
 * dependencies.
 */
const renderGrpcPowershell: RecordRenderer = (record: ConsoleRecord): string => {
  const target = `${record.host}:${String(record.port)}`
  const tlsFlag = record.protocol === 'grpc' ? '-plaintext' : ''
  const dataFlag = record.body !== undefined && record.body.length > 0
    ? `-d ${powershellSingleQuote(record.body)} `
    : ''
  const headerFlags = Object.entries(record.headers)
    .map(([k, v]) => `-H ${powershellSingleQuote(`${k}: ${v}`)}`)
    .join(' ')
  const parts = ['grpcurl']
  if (tlsFlag) parts.push(tlsFlag)
  if (headerFlags) parts.push(headerFlags)
  if (dataFlag) parts.push(dataFlag.trim())
  parts.push(powershellSingleQuote(target))
  parts.push(powershellSingleQuote(record.method))
  return renderUnixToolFallback(parts.join(' '))
}

/**
 * WebSocket PowerShell: same fallback pattern — emit the `wscat`
 * command line with a leading comment.
 */
const renderWebSocketPowershell: RecordRenderer = (record: ConsoleRecord): string => {
  const headerFlags = Object.entries(record.headers)
    .map(([k, v]) => `-H ${powershellSingleQuote(`${k}: ${v}`)}`)
    .join(' ')
  const cmd = `wscat -c ${powershellSingleQuote(record.url)}${headerFlags ? ' ' + headerFlags : ''}`
  return renderUnixToolFallback(cmd)
}

/**
 * Dispatcher: pick the right PowerShell renderer based on the
 * record's `protocol`.
 */
export const renderPowershell: RecordRenderer = (record: ConsoleRecord): string => {
  switch (record.protocol) {
    case 'grpc': return renderGrpcPowershell(record)
    case 'websocket': return renderWebSocketPowershell(record)
    default:
      return renderHttpPowershell(record)
  }
}
