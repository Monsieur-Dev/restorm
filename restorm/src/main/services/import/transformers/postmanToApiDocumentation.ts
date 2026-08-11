/**
 * Postman Collection v2.1.0 → ApiDocumentation transformer.
 *
 * Top-level folders (items with nested `item[]`) become groups; leaf items (actual
 * requests) become operations. Auth and scripts are preserved in the per-operation
 * `extra` map — sensitive auth fields are masked.
 */

import type {
  ApiDocumentation,
  GroupDocumentation,
  OperationDocumentation,
  ResponseDocumentation
} from '../../../../shared/types/apiDocumentation'

// ---------- Postman source-spec types (relevant subset) ----------

interface PostmanDescriptionData {
  content: string
  type?: string
}

interface PostmanUrlData {
  raw?: string
  host?: string[]
  path?: string[] | string
  protocol?: string
  query?: { key: string; value?: string; description?: string }[]
  variable?: { key: string; value?: string; description?: string }[]
}

interface PostmanAuthParamData {
  key: string
  value?: unknown
}

interface PostmanAuthData {
  type: string
  [scheme: string]: PostmanAuthParamData[] | string | undefined
}

interface PostmanRequestData {
  method?: string
  url?: PostmanUrlData | string
  auth?: PostmanAuthData
  description?: string | PostmanDescriptionData
}

interface PostmanResponseData {
  name?: string
  status?: string
  code?: number
  body?: string
  _postman_previewlanguage?: string
}

interface PostmanScriptData {
  exec?: string[]
  type?: string
}

interface PostmanEventData {
  listen: 'prerequest' | 'test'
  script?: PostmanScriptData
}

interface PostmanItemData {
  name: string
  description?: string | PostmanDescriptionData
  item?: PostmanItemData[]
  request?: PostmanRequestData
  response?: PostmanResponseData[]
  event?: PostmanEventData[]
  auth?: PostmanAuthData
}

export interface PostmanCollectionData {
  info: { name: string; description?: string | PostmanDescriptionData }
  item: PostmanItemData[]
  auth?: PostmanAuthData
}

export interface PostmanTransformOptions {
  sourceUrl?: string
}

// ---------- Helpers ----------

const SENSITIVE_AUTH_KEYS = new Set(['token', 'password', 'secret', 'accesskey', 'access_key', 'privatekey', 'private_key', 'clientsecret', 'client_secret', 'value'])

function extractDescription(desc: string | PostmanDescriptionData | undefined): string | undefined {
  if (!desc) return undefined
  if (typeof desc === 'string') return desc.length > 0 ? desc : undefined
  return desc.content.length > 0 ? desc.content : undefined
}

function extractUrl(url: PostmanUrlData | string | undefined): string {
  if (!url) return ''
  if (typeof url === 'string') return url
  if (url.raw) return url.raw
  // Reconstruct from components.
  const protocol = url.protocol ? `${url.protocol}://` : ''
  const host = Array.isArray(url.host) ? url.host.join('.') : ''
  const path = Array.isArray(url.path) ? '/' + url.path.join('/') : typeof url.path === 'string' ? url.path : ''
  return `${protocol}${host}${path}`
}

function maskAuthValue(key: string, value: unknown): unknown {
  if (value === undefined || value === null) return value
  const lowered = key.toLowerCase()
  if (SENSITIVE_AUTH_KEYS.has(lowered) || lowered.includes('secret') || lowered.includes('password') || lowered.includes('token')) {
    return '***'
  }
  return value
}

interface AuthExtra {
  type: string
  params?: Record<string, unknown>
}

function summarizeAuth(auth: PostmanAuthData | undefined): AuthExtra | undefined {
  if (!auth) return undefined
  const schemeParams = (auth as Record<string, unknown>)[auth.type]
  if (!Array.isArray(schemeParams)) return { type: auth.type }
  const params: Record<string, unknown> = {}
  for (const entry of schemeParams as PostmanAuthParamData[]) {
    params[entry.key] = maskAuthValue(entry.key, entry.value)
  }
  return { type: auth.type, params }
}

interface ScriptExtra {
  type: string
  code: string
}

function extractScript(events: PostmanEventData[] | undefined, listen: 'prerequest' | 'test'): ScriptExtra | undefined {
  const evt = events?.find((e) => e.listen === listen)
  const exec = evt?.script?.exec
  if (!exec || exec.length === 0) return undefined
  return { type: evt.script?.type ?? 'text/javascript', code: exec.join('\n') }
}

function mapResponses(responses: PostmanResponseData[] | undefined): Record<string, ResponseDocumentation> | undefined {
  if (!responses || responses.length === 0) return undefined
  const out: Record<string, ResponseDocumentation> = {}
  for (const resp of responses) {
    const key = resp.name ?? resp.status ?? (resp.code !== undefined ? String(resp.code) : 'response')
    const entry: ResponseDocumentation = {}
    const parts: string[] = []
    if (resp.status !== undefined) parts.push(resp.status)
    if (resp.code !== undefined) parts.push(`status ${resp.code}`)
    if (resp.body !== undefined) parts.push(resp.body)
    if (parts.length > 0) entry.description = parts.join(' — ')
    out[key] = entry
  }
  return Object.keys(out).length > 0 ? out : undefined
}

// ---------- Traversal ----------

function walkItems(
  items: PostmanItemData[],
  parentGroup: string | undefined,
  out: {
    groups: Record<string, GroupDocumentation>
    operations: OperationDocumentation[]
  }
): void {
  for (const item of items) {
    const isFolder = Array.isArray(item.item) && item.item.length > 0

    if (isFolder) {
      const folderName = item.name
      if (!out.groups[folderName]) {
        const group: GroupDocumentation = { name: folderName }
        const desc = extractDescription(item.description)
        if (desc !== undefined) group.description = desc
        out.groups[folderName] = group
      }
      walkItems(item.item ?? [], parentGroup ?? folderName, out)
      continue
    }

    // Leaf — a request.
    if (!item.request) continue
    const doc: OperationDocumentation = {
      match: {
        urlPattern: extractUrl(item.request.url),
        method: item.request.method?.toUpperCase() ?? 'GET'
      },
      summary: item.name
    }
    if (parentGroup !== undefined) doc.group = parentGroup
    const description = extractDescription(item.description) ?? extractDescription(item.request.description)
    if (description !== undefined) doc.description = description

    const extra: Record<string, unknown> = {}
    const auth = summarizeAuth(item.request.auth ?? item.auth)
    if (auth !== undefined) extra.auth = auth
    const pre = extractScript(item.event, 'prerequest')
    if (pre !== undefined) extra.prereqScript = pre
    const test = extractScript(item.event, 'test')
    if (test !== undefined) extra.testScript = test
    if (Object.keys(extra).length > 0) doc.extra = extra

    const responses = mapResponses(item.response)
    if (responses !== undefined) doc.responses = responses

    out.operations.push(doc)
  }
}

// ---------- Entry point ----------

export function postmanToApiDocumentation(
  collection: PostmanCollectionData,
  options: PostmanTransformOptions = {}
): ApiDocumentation {
  const groups: Record<string, GroupDocumentation> = {}
  const operations: OperationDocumentation[] = []

  walkItems(collection.item, undefined, { groups, operations })

  const result: ApiDocumentation = {
    sourceType: 'postman',
    api: {
      title: collection.info.name
    },
    models: {},
    groups,
    operations
  }

  const description = extractDescription(collection.info.description)
  if (description !== undefined) result.api.description = description
  if (options.sourceUrl !== undefined) result.sourceUrl = options.sourceUrl

  return result
}
