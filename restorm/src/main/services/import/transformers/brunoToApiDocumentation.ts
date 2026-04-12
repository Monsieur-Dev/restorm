/**
 * Bruno collection → ApiDocumentation transformer.
 *
 * Bruno stores each request as a .bru file inside a directory hierarchy. We turn each
 * parsed request into an operation, using the top-level subdirectory name as its group.
 */

import type {
  ApiDocumentation,
  GroupDocumentation,
  OperationDocumentation
} from '../../../../shared/types/apiDocumentation'

// ---------- Bruno source types (relevant subset) ----------

export interface BrunoMetaData {
  name: string
  type?: string
  seq?: number
}

export interface BrunoAuthData {
  type: string
  bearer?: { token?: string }
  basic?: { username?: string; password?: string }
  apikey?: { key?: string; value?: string; placement?: string }
  oauth2?: Record<string, string>
  awsv4?: Record<string, string>
  digest?: { username?: string; password?: string }
}

export interface BrunoRequestData {
  meta: BrunoMetaData
  method: string
  url: string
  auth: BrunoAuthData
  docs?: string
  script?: {
    prerequest?: string
    postresponse?: string
  }
}

export interface BrunoCollectionMeta {
  name?: string
  version?: string
  type?: string
}

export interface BrunoSourceData {
  collection?: BrunoCollectionMeta
  /** One entry per parsed .bru file, keyed by the relative path (e.g., "pet/GetPet.bru"). */
  requests: { path: string; request: BrunoRequestData }[]
}

export interface BrunoTransformOptions {
  /** Fallback API title when the collection has no bruno.json name. */
  name?: string
  sourceUrl?: string
}

// ---------- Helpers ----------

const SENSITIVE_AUTH_KEYS = new Set(['token', 'password', 'secret', 'clientSecret', 'clientsecret', 'value'])

function maskValue(key: string, value: unknown): unknown {
  if (value === undefined || value === null) return value
  const lowered = key.toLowerCase()
  if (SENSITIVE_AUTH_KEYS.has(key) || lowered.includes('secret') || lowered.includes('password') || lowered.includes('token')) {
    return '***'
  }
  return value
}

function summarizeAuth(auth: BrunoAuthData | undefined): { type: string; params?: Record<string, unknown> } | undefined {
  if (!auth || auth.type === 'none') return undefined
  const params: Record<string, unknown> = {}
  const scheme = (auth as Record<string, unknown>)[auth.type]
  if (scheme && typeof scheme === 'object') {
    for (const [k, v] of Object.entries(scheme)) {
      params[k] = maskValue(k, v)
    }
  }
  const out: { type: string; params?: Record<string, unknown> } = { type: auth.type }
  if (Object.keys(params).length > 0) out.params = params
  return out
}

function topLevelGroupFromPath(filePath: string): string | undefined {
  const parts = filePath.split('/').filter(Boolean)
  if (parts.length < 2) return undefined // file sits at the root
  return parts[0]
}

// ---------- Entry point ----------

export function brunoToApiDocumentation(
  data: BrunoSourceData,
  options: BrunoTransformOptions = {}
): ApiDocumentation {
  const title = data.collection?.name ?? options.name ?? 'Bruno Collection'

  const groups: Record<string, GroupDocumentation> = {}
  const operations: OperationDocumentation[] = []

  for (const { path, request } of data.requests) {
    const doc: OperationDocumentation = {
      match: {
        urlPattern: request.url,
        method: request.method.toUpperCase()
      },
      summary: request.meta.name
    }
    const groupName = topLevelGroupFromPath(path)
    if (groupName !== undefined) {
      doc.group = groupName
      if (!groups[groupName]) {
        const group: GroupDocumentation = { name: groupName }
        groups[groupName] = group
      }
    }
    if (request.docs !== undefined) doc.description = request.docs

    const extra: Record<string, unknown> = {}
    const auth = summarizeAuth(request.auth)
    if (auth !== undefined) extra.auth = auth
    if (request.script?.prerequest !== undefined && request.script.prerequest.trim() !== '') {
      extra.prereqScript = { code: request.script.prerequest }
    }
    if (request.script?.postresponse !== undefined && request.script.postresponse.trim() !== '') {
      extra.postScript = { code: request.script.postresponse }
    }
    if (Object.keys(extra).length > 0) doc.extra = extra

    operations.push(doc)
  }

  const result: ApiDocumentation = {
    sourceType: 'bruno',
    api: { title },
    models: {},
    groups,
    operations
  }

  if (options.sourceUrl !== undefined) result.sourceUrl = options.sourceUrl

  return result
}
