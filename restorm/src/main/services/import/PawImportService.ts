/**
 * Service for importing Paw (RapidAPI for Mac) JSON export files into Restorm collections
 *
 * Scope: Paw's exported JSON format only — the native `.paw` bundle is a binary
 * archive in recent versions and is out of scope; users export to JSON first.
 *
 * Supports:
 * - HTTP requests (method, URL, headers, query params, body, description)
 * - Nested request groups (folders)
 * - Environments and environment variables
 * - Paw "dynamic values" (computed fields) mapped to the closest Handlebars
 *   helper where one exists; unmapped kinds become a literal placeholder with
 *   a note attached to the affected field's description.
 */

import {
  Folder,
  EnvironmentFolder,
  Environment,
  HTTPRequest,
  type HTTPRequestBody,
  type KeyValue,
  type Request,
  type FolderItem
} from '../../../shared/models'
import { toHTTPMethod } from './httpMethodValidator'
import { createTypedKeyValue } from '../../../shared/utils/createTypedKeyValue'
import { CURRENT_FILE_FORMAT_VERSION } from '../../../shared/config/fileFormatVersion'
import { stableImportId as generateId } from './stableImportId'

// ============================================================================
// Paw JSON Export Types
// ============================================================================

/** Discriminator for one of Paw's "dynamic value" kinds we recognize. */
const PAW_DYNAMIC_VALUE_CLASS = 'com.luckymarmot.DynamicValue'

interface PawDynamicValue {
  $class: string
  type: string
  [extra: string]: unknown
}

/** A field value is either a plain literal or one of Paw's dynamic values. */
type PawFieldValue = string | PawDynamicValue

interface PawKeyValueEntry {
  key: string
  value: PawFieldValue
  description?: string
  disabled?: boolean
}

interface PawBody {
  /** Paw's own body-type tag; `json`/`text`/`xml` all carry a raw string in `value`. */
  type: 'none' | 'json' | 'text' | 'xml' | 'form' | 'multipart'
  value?: PawFieldValue
  fields?: PawKeyValueEntry[]
}

interface PawRequestNode {
  id: string
  name: string
  method: string
  urlBase: PawFieldValue
  urlParameters?: PawKeyValueEntry[]
  headers?: PawKeyValueEntry[]
  body?: PawBody
  description?: string
  parentId?: string | null
  order?: number
}

interface PawRequestGroupNode {
  id: string
  name: string
  parentId?: string | null
  order?: number
}

interface PawEnvironmentNode {
  id: string
  name: string
  variables?: Record<string, PawFieldValue>
}

interface PawExport {
  pawVersion?: number
  $schema?: string
  requests: Record<string, PawRequestNode>
  requestGroups?: Record<string, PawRequestGroupNode>
  environments?: Record<string, PawEnvironmentNode>
}

// ============================================================================
// Dynamic value resolution
// ============================================================================

/**
 * Resolve one Paw field value to a literal string, mapping recognized dynamic
 * values to their Handlebars equivalent. Unrecognized dynamic values (Paw
 * scripting extensions like `ResponseBodyDynamicValue` or `CookieJarDynamicValue`
 * have no restorm counterpart) fall back to a placeholder literal, and a note
 * describing the loss is returned alongside so the caller can attach it to the
 * field's description.
 */
function resolvePawValue(value: PawFieldValue, fieldLabel: string): { value: string; note?: string } {
  if (typeof value === 'string') return { value }

  if (value.$class === PAW_DYNAMIC_VALUE_CLASS) {
    switch (value.type) {
      case 'com.luckymarmot.RandomStringDynamicValue':
        return { value: '{{$randomAlphaNumeric}}' }
      case 'com.luckymarmot.TimestampDynamicValue':
        return { value: '{{$timestamp}}' }
      case 'com.luckymarmot.UUIDDynamicValue':
        return { value: '{{$guid}}' }
      default:
        return {
          value: '[[paw:unsupported-dynamic-value]]',
          note: `${fieldLabel} used an unsupported Paw dynamic value (${value.type}); replaced with a placeholder.`
        }
    }
  }

  return {
    value: '[[paw:unsupported-dynamic-value]]',
    note: `${fieldLabel} used an unrecognized Paw dynamic value; replaced with a placeholder.`
  }
}

/** Append a resolution note to an existing description, if any. */
function withNote(description: string | undefined, note: string | undefined): string | undefined {
  if (!note) return description
  return description ? `${description}\n\n${note}` : note
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Convert Paw key/value entries (headers, params, form fields) to KeyValue array. */
function parseKeyValues(entries: PawKeyValueEntry[] | undefined, labelPrefix: string): KeyValue[] {
  if (!entries) return []

  return entries
    .filter((e) => !e.disabled)
    .map((e) => {
      const resolved = resolvePawValue(e.value, `${labelPrefix} "${e.key}"`)
      return createTypedKeyValue({
        key: e.key,
        value: resolved.value,
        description: withNote(e.description, resolved.note),
        enabled: true
      })
    })
}

/** Convert a Paw body to an HTTPRequestBody. */
function parseBody(body: PawBody | undefined, requestName: string): { body?: HTTPRequestBody; note?: string } {
  if (!body || body.type === 'none') return {}

  if (body.type === 'form') {
    return { body: { type: 'x-www-form-urlencoded', fields: parseKeyValues(body.fields, `${requestName} body field`) } }
  }

  if (body.type === 'multipart') {
    return { body: { type: 'form-data', fields: parseKeyValues(body.fields, `${requestName} body field`) } }
  }

  // json / text / xml all carry a raw string payload.
  if (body.value !== undefined) {
    const resolved = resolvePawValue(body.value, `${requestName} body`)
    return { body: { type: 'text', content: resolved.value }, note: resolved.note }
  }

  return {}
}

/** Convert a Paw request to an HTTPRequest. */
function requestToHTTPRequest(request: PawRequestNode): HTTPRequest {
  const url = resolvePawValue(request.urlBase, `${request.name} URL`)
  const { body, note: bodyNote } = parseBody(request.body, request.name)

  const httpRequest: HTTPRequest = {
    type: 'http',
    id: generateId(`paw:request:${request.id}`),
    name: request.name,
    tags: [],
    method: toHTTPMethod(request.method),
    url: url.value,
    headers: parseKeyValues(request.headers, `${request.name} header`),
    params: parseKeyValues(request.urlParameters, `${request.name} query param`)
  }

  const documentation = withNote(withNote(request.description, url.note), bodyNote)
  if (documentation) httpRequest.documentation = documentation

  if (body) httpRequest.body = body

  return httpRequest
}

/** Build the folder tree from Paw request groups + requests, keyed by parentId. */
function buildFolderTree(exportData: PawExport, parentId: string | null): FolderItem[] {
  const items: FolderItem[] = []

  const groups = Object.values(exportData.requestGroups ?? {})
    .filter((g) => (g.parentId ?? null) === parentId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  for (const group of groups) {
    const folder: Folder = {
      id: generateId(`paw:folder:${group.id}`),
      name: group.name,
      tags: [],
      configuration: {},
      items: buildFolderTree(exportData, group.id)
    }
    items.push(folder)
  }

  const requests = Object.values(exportData.requests)
    .filter((r) => (r.parentId ?? null) === parentId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  for (const request of requests) {
    const converted: Request = requestToHTTPRequest(request)
    items.push(converted)
  }

  return items
}

/** Extract environments from Paw's `environments` dict. */
function extractEnvironments(exportData: PawExport): Environment[] {
  const envNodes = Object.values(exportData.environments ?? {})

  const environments = envNodes.map((env) => {
    const variables: KeyValue[] = Object.entries(env.variables ?? {}).map(([key, rawValue]) => {
      const resolved = resolvePawValue(rawValue, `environment "${env.name}" variable "${key}"`)
      return createTypedKeyValue({ key, value: resolved.value, description: resolved.note, enabled: true })
    })

    return {
      id: generateId(`paw:env:${env.id}`),
      name: env.name,
      variables
    }
  })

  if (environments.length === 0) {
    environments.push({ id: generateId('paw:env:default'), name: 'Default', variables: [] })
  }

  return environments
}

// ============================================================================
// Main Service
// ============================================================================

export interface PawImportOptions {
  /** Original URL the Paw export was fetched from (unused today — Paw exports
   * are always a local file/paste, kept for parity with the ImportManager contract). */
  sourceUrl?: string
}

/**
 * Import a Paw JSON export and convert it to an EnvironmentFolder structure.
 */
export function importPaw(exportData: PawExport, _options: PawImportOptions = {}): EnvironmentFolder {
  // Cast to unknown first so a malformed/untyped caller (JSON.parse output,
  // a hand-built test fixture) is validated at runtime rather than trusted.
  const requests: unknown = (exportData as unknown as Record<string, unknown>).requests
  if (typeof requests !== 'object' || requests === null) {
    throw new Error('Invalid Paw export: missing "requests"')
  }

  const environments = extractEnvironments(exportData)
  const items = buildFolderTree(exportData, null)

  const rootFolder: EnvironmentFolder = {
    folderType: 'environment',
    fileFormatVersion: CURRENT_FILE_FORMAT_VERSION,
    importSource: 'paw',
    id: generateId('paw:root'),
    name: 'Paw Import',
    tags: [],
    configuration: {},
    environments,
    items
  }

  return rootFolder
}

/**
 * Import a Paw JSON export from a JSON string.
 */
export function importPawFromJson(json: string, options: PawImportOptions = {}): EnvironmentFolder {
  const exportData = JSON.parse(json) as PawExport
  return importPaw(exportData, options)
}

// ============================================================================
// Provider registration
// ============================================================================

import { importProviders } from './registry'

function isPlainDict(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function canImport(content: string, _filePath?: string): boolean {
  const trimmed = content.trim()
  let json: unknown
  try {
    json = JSON.parse(trimmed)
  } catch {
    return false
  }
  if (!isPlainDict(json)) return false

  if ('pawVersion' in json) return true
  const schema = json.$schema
  if (typeof schema === 'string' && schema.toLowerCase().includes('paw')) return true

  // Paw's export shape is a dict of requests keyed by uuid (NOT an array like
  // Postman's `item[]` or Insomnia's `resources[]`) alongside a matching
  // requestGroups dict — that combination is specific enough to discriminate.
  return isPlainDict(json.requests) && isPlainDict(json.requestGroups)
}

importProviders.push({ format: 'paw', canImport, parse: (content, opts) => importPawFromJson(content, opts) })
