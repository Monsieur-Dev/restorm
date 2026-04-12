/**
 * Insomnia v4 export → ApiDocumentation transformer.
 *
 * Insomnia stores its workspace as a flat list of resources linked via parentId:
 * workspace → request_group → request (or grpc_request / websocket_request).
 * We pick the workspace as the API, top-level request_groups as groups, and each
 * request as an operation — the match key adapts to the request type.
 */

import type {
  ApiDocumentation,
  GroupDocumentation,
  OperationDocumentation
} from '../../../../shared/types/apiDocumentation'

// ---------- Insomnia source types (relevant subset) ----------

export interface InsomniaAuthData {
  type: string
  username?: string
  password?: string
  token?: string
  prefix?: string
  key?: string
  value?: string
  clientId?: string
  clientSecret?: string
  disabled?: boolean
}

export interface InsomniaWorkspaceData {
  _id: string
  _type: 'workspace'
  name: string
  description?: string
  parentId: string | null
}

export interface InsomniaRequestGroupData {
  _id: string
  _type: 'request_group'
  name: string
  description?: string
  parentId: string | null
}

export interface InsomniaRequestData {
  _id: string
  _type: 'request'
  name: string
  description?: string
  parentId: string | null
  method?: string
  url?: string
  authentication?: InsomniaAuthData
}

export interface InsomniaGrpcRequestData {
  _id: string
  _type: 'grpc_request'
  name: string
  description?: string
  parentId: string | null
  protoMethodName?: string
  url?: string
}

export interface InsomniaWebSocketRequestData {
  _id: string
  _type: 'websocket_request'
  name: string
  description?: string
  parentId: string | null
  url?: string
  authentication?: InsomniaAuthData
}

export type InsomniaResourceData =
  | InsomniaWorkspaceData
  | InsomniaRequestGroupData
  | InsomniaRequestData
  | InsomniaGrpcRequestData
  | InsomniaWebSocketRequestData

export interface InsomniaExportData {
  _type: 'export'
  resources: InsomniaResourceData[]
}

export interface InsomniaTransformOptions {
  sourceUrl?: string
}

// ---------- Helpers ----------

const SENSITIVE_AUTH_KEYS = new Set(['token', 'password', 'secret', 'clientSecret', 'clientsecret', 'value'])

function maskAuth(auth: InsomniaAuthData | undefined): Record<string, unknown> | undefined {
  if (!auth) return undefined
  const out: Record<string, unknown> = { type: auth.type }
  for (const [k, v] of Object.entries(auth)) {
    if (k === 'type') continue
    if (v === undefined) continue
    const lowered = k.toLowerCase()
    if (SENSITIVE_AUTH_KEYS.has(k) || lowered.includes('secret') || lowered.includes('password') || lowered.includes('token')) {
      out[k] = '***'
    } else {
      out[k] = v
    }
  }
  return out
}

function findWorkspace(resources: InsomniaResourceData[]): InsomniaWorkspaceData | undefined {
  for (const r of resources) {
    if (r._type === 'workspace') return r
  }
  return undefined
}

/** Return the top-level request_group ancestor of a resource (for grouping), if any. */
function findTopLevelGroupName(
  resourceId: string,
  parentMap: Map<string, string | null>,
  resourceMap: Map<string, InsomniaResourceData>,
  workspaceId: string
): string | undefined {
  let current = parentMap.get(resourceId) ?? null
  let lastGroupId: string | undefined
  while (current && current !== workspaceId) {
    const parent = resourceMap.get(current)
    if (parent?._type === 'request_group') {
      lastGroupId = parent._id
      current = parentMap.get(current) ?? null
    } else {
      break
    }
  }
  if (!lastGroupId) return undefined
  const last = resourceMap.get(lastGroupId)
  return last?._type === 'request_group' ? last.name : undefined
}

// ---------- Entry point ----------

export function insomniaToApiDocumentation(
  exportData: InsomniaExportData,
  options: InsomniaTransformOptions = {}
): ApiDocumentation {
  const workspace = findWorkspace(exportData.resources)
  const title = workspace?.name ?? 'Insomnia API'

  const resourceMap = new Map<string, InsomniaResourceData>()
  const parentMap = new Map<string, string | null>()
  for (const r of exportData.resources) {
    resourceMap.set(r._id, r)
    parentMap.set(r._id, r.parentId)
  }

  const groups: Record<string, GroupDocumentation> = {}
  for (const r of exportData.resources) {
    if (r._type !== 'request_group') continue
    // Only surface top-level groups (direct child of workspace) as groups.
    if (r.parentId !== workspace?._id) continue
    const group: GroupDocumentation = { name: r.name }
    if (r.description !== undefined) group.description = r.description
    groups[r.name] = group
  }

  const operations: OperationDocumentation[] = []
  const workspaceId = workspace?._id ?? ''

  for (const r of exportData.resources) {
    if (r._type !== 'request' && r._type !== 'grpc_request' && r._type !== 'websocket_request') continue

    const doc: OperationDocumentation = {
      match: { urlPattern: r.url ?? '' },
      summary: r.name
    }
    if (r.description !== undefined) doc.description = r.description

    const groupName = findTopLevelGroupName(r._id, parentMap, resourceMap, workspaceId)
    if (groupName !== undefined) doc.group = groupName

    if (r._type === 'request') {
      if (r.method !== undefined) doc.match.method = r.method.toUpperCase()
      const auth = maskAuth(r.authentication)
      if (auth !== undefined) doc.extra = { auth }
    } else if (r._type === 'grpc_request') {
      if (r.protoMethodName !== undefined) doc.match.operationName = r.protoMethodName
    } else {
      const auth = maskAuth(r.authentication)
      if (auth !== undefined) doc.extra = { auth }
    }

    operations.push(doc)
  }

  const result: ApiDocumentation = {
    sourceType: 'insomnia',
    api: { title },
    models: {},
    groups,
    operations
  }

  if (workspace?.description !== undefined) result.api.description = workspace.description
  if (options.sourceUrl !== undefined) result.sourceUrl = options.sourceUrl

  return result
}
