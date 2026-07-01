/**
 * Service for importing VSCode REST Client (`.http` / `.rest`) files into
 * Restorm collections
 *
 * Supports:
 * - Multiple requests separated by `###` lines
 * - Request line: `METHOD URL` (an optional trailing `HTTP/x.x` is ignored)
 * - Headers (`Key: Value`) up to the first blank line
 * - Blank-line-separated body (JSON, XML, form-urlencoded, plain text — kept verbatim)
 * - `{{var}}` placeholders — already Handlebars-compatible, passed through untouched
 * - `@name = value` variable declarations before the first `###` → folder-level env variables
 * - `# @name <id>` comment inside a block → request name
 */

import {
  EnvironmentFolder,
  Environment,
  HTTPRequest,
  type HTTPMethod,
  type KeyValue
} from '../../../shared/models'
import { toHTTPMethod } from './httpMethodValidator'
import { createTypedKeyValue } from '../../../shared/utils/createTypedKeyValue'
import { stableImportId } from './stableImportId'

// ============================================================================
// Parsing
// ============================================================================

const REQUEST_LINE = /^([A-Za-z]+)\s+(\S+)(?:\s+HTTP\/[\d.]+)?\s*$/
const VARIABLE_LINE = /^@([^\s=]+)\s*=\s*(.*)$/
const NAME_COMMENT = /^#\s*@name\s+(\S+)/i
const HEADER_LINE = /^([^:\s][^:]*):\s*(.*)$/

interface ParsedBlock {
  title?: string
  name?: string
  method: HTTPMethod
  url: string
  headers: { key: string; value: string }[]
  body?: string
}

/** Parse the `@name = value` declarations that precede the first `###` separator. */
function parseTopLevelVariables(preamble: string): { key: string; value: string }[] {
  const variables: { key: string; value: string }[] = []
  for (const line of preamble.split('\n')) {
    const match = VARIABLE_LINE.exec(line.trim())
    if (match) variables.push({ key: match[1], value: match[2].trim() })
  }
  return variables
}

/** Parse one `###`-delimited chunk into a request, or `null` if it carries no request line. */
function parseBlock(chunk: string): ParsedBlock | null {
  const lines = chunk.split('\n')
  // Text following `###` on the separator line (e.g. "### Get users") is REST
  // Client's own request title — used as a request-name fallback.
  const rawTitle = lines.shift()?.trim()
  let title: string | undefined
  if (rawTitle) title = rawTitle

  let name: string | undefined
  let requestLineIndex = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line === '') continue
    const nameMatch = NAME_COMMENT.exec(line)
    if (nameMatch) {
      name = nameMatch[1]
      continue
    }
    // Best-effort skip for anything else that isn't the request line itself:
    // plain comments (`#`/`//`), REST Client directives (`# @prompt`, `# @note`)
    // and in-block `@var = value` declarations (only top-of-file ones become
    // env variables — see the module doc). Never abort the block over these.
    if (line.startsWith('#') || line.startsWith('//') || VARIABLE_LINE.test(line)) continue
    const requestMatch = REQUEST_LINE.exec(line)
    if (requestMatch) {
      requestLineIndex = i
      break
    }
  }
  if (requestLineIndex === -1) return null

  const requestMatch = REQUEST_LINE.exec(lines[requestLineIndex].trim())
  if (!requestMatch) return null
  const method = toHTTPMethod(requestMatch[1])
  const url = requestMatch[2]

  const headers: { key: string; value: string }[] = []
  let bodyStartIndex = -1
  for (let i = requestLineIndex + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') {
      bodyStartIndex = i + 1
      break
    }
    const headerMatch = HEADER_LINE.exec(line)
    if (headerMatch) headers.push({ key: headerMatch[1].trim(), value: headerMatch[2].trim() })
  }

  let body: string | undefined
  if (bodyStartIndex !== -1) {
    const rawBody = lines.slice(bodyStartIndex).join('\n').trim()
    if (rawBody) body = rawBody
  }

  return {
    ...(title ? { title } : {}),
    ...(name ? { name } : {}),
    method,
    url,
    headers,
    ...(body !== undefined ? { body } : {})
  }
}

/**
 * Split the file into the top-of-file `@var` preamble and the request blocks.
 *
 * REST Client only requires a `###` separator *between* requests — a
 * single-request file may carry no separator at all. So the preamble is
 * narrowed to the contiguous run of blank/`@var` lines at the very top; the
 * first non-variable line starts the request content, which is then
 * `###`-split as usual (a synthetic leading `###` is added when the content
 * doesn't already open with one, so a separator-less single request still
 * becomes exactly one block).
 */
function splitIntoBlocks(input: string): { preamble: string; blocks: string[] } {
  const lines = input.split('\n')
  let cut = 0
  while (cut < lines.length) {
    const trimmed = lines[cut].trim()
    if (trimmed === '' || VARIABLE_LINE.test(trimmed)) {
      cut++
      continue
    }
    break
  }
  const preamble = lines.slice(0, cut).join('\n')
  const rest = lines.slice(cut).join('\n')
  if (rest.trim() === '') return { preamble, blocks: [] }

  const normalized = rest.trimStart().startsWith('###') ? rest : `###\n${rest}`
  const blocks = normalized.split(/^###/m).slice(1)
  return { preamble, blocks }
}

/** Turn one parsed block into an `HTTPRequest`, resolving query params + naming. */
function blockToRequest(block: ParsedBlock, index: number): HTTPRequest {
  const headers: KeyValue[] = block.headers.map(h =>
    createTypedKeyValue({ key: h.key, value: h.value, enabled: true })
  )

  // Split off query params when the URL is absolute. Templated
  // (`{{baseUrl}}/x`) or relative URLs make `new URL` throw — keep the raw
  // URL verbatim rather than dropping the request.
  const params: KeyValue[] = []
  let requestUrl = block.url
  let pathname = block.url
  try {
    const parsed = new URL(block.url)
    parsed.searchParams.forEach((value, key) => {
      params.push(createTypedKeyValue({ key, value, enabled: true }))
    })
    pathname = parsed.pathname || '/'
    requestUrl = parsed.origin + parsed.pathname
  } catch {
    // Non-absolute URL — keep it verbatim so the request still imports.
  }

  const name = block.name ?? block.title ?? `${block.method} ${pathname}`

  return new HTTPRequest({
    id: stableImportId(`rest-client:${index}:${block.method}:${block.url}`),
    name,
    method: block.method,
    url: requestUrl,
    headers,
    params,
    ...(block.body !== undefined ? { body: { type: 'text', content: block.body } } : {}),
    tags: ['rest-client-import']
  })
}

// ============================================================================
// Export Function
// ============================================================================

/**
 * Import a REST Client `.http`/`.rest` document into a Restorm `EnvironmentFolder`.
 * @param input - The full `.http`/`.rest` file content
 * @param options - Import options
 */
export function importRestClient(
  input: string,
  options: { folderName?: string } = {}
): EnvironmentFolder {
  const { preamble, blocks } = splitIntoBlocks(input)

  const requests = blocks
    .map(chunk => parseBlock(chunk))
    .map((block, index) => (block ? blockToRequest(block, index) : null))
    .filter((request): request is HTTPRequest => request !== null)

  const topLevelVariables = parseTopLevelVariables(preamble)
  const environments: Environment[] = []
  if (topLevelVariables.length > 0) {
    environments.push(
      new Environment({
        id: stableImportId('rest-client:env:Default'),
        name: 'Default',
        variables: topLevelVariables.map(v => createTypedKeyValue({ key: v.key, value: v.value, enabled: true }))
      })
    )
  }

  return new EnvironmentFolder({
    name: options.folderName ?? 'REST Client Imports',
    tags: ['rest-client'],
    importSource: 'rest-client',
    items: requests,
    environments
  })
}

// ============================================================================
// Provider registration
// ============================================================================

import { importProviders } from './registry'

const CAN_IMPORT_LEADING_LINE = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|CONNECT|TRACE)\s+https?:/i

function canImport(content: string, filePath?: string): boolean {
  if (filePath && /\.(http|rest)$/i.test(filePath)) return true
  const firstLine = content
    .split('\n')
    .map(line => line.trim())
    .find(line => line !== '')
  return firstLine !== undefined && CAN_IMPORT_LEADING_LINE.test(firstLine)
}

importProviders.push({ format: 'rest-client', canImport, parse: (content) => importRestClient(content) })
