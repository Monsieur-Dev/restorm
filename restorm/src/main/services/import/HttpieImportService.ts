/**
 * Service for importing HTTPie export files into Restorm collections
 *
 * Supports two distinct HTTPie export shapes:
 * - HTTPie Desktop collection export (JSON tree of folders + requests).
 * - HTTPie CLI session file (JSON snapshot of persistent headers / auth for
 *   a named target), imported as an environment carrying that state.
 *
 * cURL-style HTTPie one-liners are out of scope here — they're covered by
 * the existing cURL importer.
 */

import {
  Folder,
  EnvironmentFolder,
  Environment,
  HTTPRequest,
  type HTTPRequestBody,
  type KeyValue,
  type FolderItem
} from '../../../shared/models'
import { toHTTPMethod } from './httpMethodValidator'
import { createTypedKeyValue } from '../../../shared/utils/createTypedKeyValue'
import { stableImportId } from './stableImportId'

// ============================================================================
// HTTPie Desktop Collection Types
// ============================================================================

interface HttpieDesktopExport {
  app: 'HTTPie Desktop'
  version: string
  collections: HttpieCollectionNode[]
}

interface HttpieCollectionNode {
  name: string
  children?: HttpieNode[]
}

interface HttpieRequestNode {
  type: 'request'
  name: string
  method: string
  url: string
  headers?: Record<string, string>
  params?: Record<string, string>
  body?: {
    contentType?: string
    data?: string | Record<string, string>
  }
}

interface HttpieFolderNode {
  type?: 'folder'
  name: string
  children?: HttpieNode[]
}

type HttpieNode = HttpieRequestNode | HttpieFolderNode

function isRequestNode(node: HttpieNode): node is HttpieRequestNode {
  return node.type === 'request'
}

// ============================================================================
// HTTPie CLI Session Types
// ============================================================================

interface HttpieSession {
  __version__?: string
  __meta__?: Record<string, unknown>
  headers?: Record<string, string>
  auth?: {
    type?: string | null
    username?: string | null
    password?: string | null
  }
  cookies?: unknown
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Convert a flat header/param map to a KeyValue array, skipping blank keys. */
function toKeyValues(record: Record<string, string> | undefined): KeyValue[] {
  if (!record) return []
  return Object.entries(record)
    .filter(([key]) => key.trim() !== '')
    .map(([key, value]) => createTypedKeyValue({ key, value, enabled: true }))
}

/** Convert a HTTPie Desktop request body to an HTTPRequestBody */
function parseDesktopBody(body: HttpieRequestNode['body']): HTTPRequestBody | undefined {
  if (body?.data === undefined) return undefined

  const contentType = body.contentType ?? ''

  if (typeof body.data === 'object') {
    const fields = Object.entries(body.data)
      .filter(([key]) => key.trim() !== '')
      .map(([key, value]) => createTypedKeyValue({ key, value, enabled: true }))
    if (fields.length === 0) return undefined
    return contentType.includes('form-urlencoded')
      ? { type: 'x-www-form-urlencoded', fields }
      : { type: 'text', content: JSON.stringify(body.data, null, 2) }
  }

  const text = body.data.trim()
  return text === '' ? undefined : { type: 'text', content: body.data }
}

/** Convert a single HTTPie Desktop node (request or folder) into a FolderItem */
function convertNode(node: HttpieNode, pathPrefix: string): FolderItem {
  const path = `${pathPrefix}/${node.name}`

  if (isRequestNode(node)) {
    const httpRequest: HTTPRequest = {
      type: 'http',
      id: stableImportId(`httpie:request:${path}`),
      name: node.name,
      tags: [],
      method: toHTTPMethod(node.method),
      url: node.url,
      headers: toKeyValues(node.headers),
      params: toKeyValues(node.params)
    }

    const body = parseDesktopBody(node.body)
    if (body) httpRequest.body = body

    return httpRequest
  }

  const folder: Folder = {
    id: stableImportId(`httpie:folder:${path}`),
    name: node.name,
    tags: [],
    configuration: {},
    items: (node.children ?? []).map(child => convertNode(child, path))
  }

  return folder
}

// ============================================================================
// Main Service — Desktop collection
// ============================================================================

export interface HttpieCollectionImportOptions {
  /** Base URL to use if not defined elsewhere */
  baseUrl?: string
  /**
   * Existing EnvironmentFolder to add the environment to.
   * If not provided, a new EnvironmentFolder will be created as root.
   */
  environmentFolder?: EnvironmentFolder
  /**
   * Parent folder where requests will be imported.
   * If provided with environmentFolder, requests will be imported here instead of environmentFolder.
   */
  parentFolder?: Folder
  /** Original URL the HTTPie export was fetched from (stored on ApiDocumentation.sourceUrl). */
  sourceUrl?: string
}

/**
 * Import an HTTPie Desktop collection export and convert it to a Folder structure.
 * A single top-level collection becomes the root folder; multiple top-level
 * collections each become a sub-folder under a generic root.
 */
export function importHttpieCollection(
  data: HttpieDesktopExport,
  options: HttpieCollectionImportOptions = {}
): EnvironmentFolder {
  const collections = data.collections
  const singleCollection = collections.length === 1 ? collections[0] : undefined
  const rootName = singleCollection?.name ?? 'HTTPie Import'

  const items: FolderItem[] = singleCollection
    ? (singleCollection.children ?? []).map(child => convertNode(child, singleCollection.name))
    : collections.map(collection => convertNode({ ...collection, type: 'folder' }, ''))

  const environment: Environment = {
    id: stableImportId(`httpie:env:${rootName}`),
    name: 'Default',
    variables: options.baseUrl ? [createTypedKeyValue({ key: 'baseUrl', value: options.baseUrl, enabled: true })] : []
  }

  // Case: parentFolder provided without environmentFolder - error
  if (options.parentFolder && !options.environmentFolder) {
    throw new Error('parentFolder requires an environmentFolder to store the environment configuration')
  }

  // Case: environmentFolder provided (with or without parentFolder)
  if (options.environmentFolder) {
    options.environmentFolder.environments = [
      ...options.environmentFolder.environments,
      environment
    ]

    const targetFolder = options.parentFolder ?? options.environmentFolder
    targetFolder.items = [...targetFolder.items, ...items]

    return options.environmentFolder
  }

  // Case: No options - create new EnvironmentFolder as root
  const rootFolder: EnvironmentFolder = {
    folderType: 'environment',
    importSource: 'httpie',
    id: stableImportId(`httpie:root:${rootName}`),
    name: rootName,
    tags: [],
    configuration: {},
    environments: [environment],
    items
  }

  return rootFolder
}

/**
 * Import an HTTPie Desktop collection export from a JSON string
 */
export function importHttpieCollectionFromJson(
  json: string,
  options: HttpieCollectionImportOptions = {}
): EnvironmentFolder {
  const data = JSON.parse(json) as HttpieDesktopExport
  return importHttpieCollection(data, options)
}

// ============================================================================
// Main Service — CLI session
// ============================================================================

export interface HttpieSessionImportOptions {
  /**
   * Base URL for the session's target. HTTPie CLI sessions don't carry the
   * target host in the file itself (it's implied by the
   * `~/.httpie/sessions/<host>/<name>.json` path on disk, which this
   * generic content-based importer never sees) — pass it explicitly when
   * known, otherwise the variable is left for the user to fill in.
   */
  baseUrl?: string
  /** Name of the resulting environment folder */
  folderName?: string
}

/**
 * Import an HTTPie CLI session file as an EnvironmentFolder carrying its
 * persistent state (base URL + headers + auth) as environment variables.
 * A session file has no requests of its own, so the folder is created empty.
 */
export function importHttpieSession(
  session: HttpieSession,
  options: HttpieSessionImportOptions = {}
): EnvironmentFolder {
  const name = options.folderName ?? 'HTTPie Session'

  const variables: KeyValue[] = []
  if (options.baseUrl) {
    variables.push(createTypedKeyValue({ key: 'baseUrl', value: options.baseUrl, enabled: true }))
  }
  variables.push(...toKeyValues(session.headers))

  const auth = session.auth
  if (auth?.type) {
    variables.push(createTypedKeyValue({ key: 'authType', value: auth.type, enabled: true }))
    if (auth.username) {
      variables.push(createTypedKeyValue({ key: 'authUsername', value: auth.username, enabled: true }))
    }
    if (auth.password) {
      variables.push(createTypedKeyValue({ key: 'authPassword', value: auth.password, enabled: true }))
    }
  }

  const environment: Environment = {
    id: stableImportId(`httpie:session-env:${name}`),
    name: 'Default',
    variables
  }

  const rootFolder: EnvironmentFolder = {
    folderType: 'environment',
    importSource: 'httpie',
    id: stableImportId(`httpie:session:${name}`),
    name,
    tags: ['httpie-session'],
    configuration: {},
    environments: [environment],
    items: []
  }

  return rootFolder
}

/**
 * Import an HTTPie CLI session from a JSON string
 */
export function importHttpieSessionFromJson(
  json: string,
  options: HttpieSessionImportOptions = {}
): EnvironmentFolder {
  const session = JSON.parse(json) as HttpieSession
  return importHttpieSession(session, options)
}

// ============================================================================
// Provider registration
// ============================================================================

import { importProviders } from './registry'

function parseJson(content: string): unknown {
  try {
    return JSON.parse(content.trim())
  } catch {
    return undefined
  }
}

function isDesktopCollection(json: unknown): json is HttpieDesktopExport {
  if (typeof json !== 'object' || json === null) return false
  const obj = json as Record<string, unknown>
  return obj.app === 'HTTPie Desktop' && Array.isArray(obj.collections)
}

function isCliSession(json: unknown): json is HttpieSession {
  if (typeof json !== 'object' || json === null) return false
  const obj = json as Record<string, unknown>
  return '__meta__' in obj && 'headers' in obj && !('app' in obj) && !('collections' in obj)
}

function canImport(content: string, _filePath?: string, parsed?: unknown): boolean {
  const json = parsed !== undefined ? parsed : parseJson(content)
  return isDesktopCollection(json) || isCliSession(json)
}

function parse(content: string, opts: { sourceUrl?: string }): EnvironmentFolder {
  const json: unknown = JSON.parse(content.trim())
  return isDesktopCollection(json)
    ? importHttpieCollection(json, opts)
    : importHttpieSession(json as HttpieSession, opts)
}

importProviders.push({ format: 'httpie', canImport, parse })
