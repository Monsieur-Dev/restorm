import type { RuntimeId, Icon, Environment, FolderConfiguration, EnumDefinition, CustomValueList, ImportSourceType, ApiUpdateConfig } from './baseTypes'
import type { Request } from './requests/index'
import type { Scenario } from './scenario'
import type { ApiDesign } from './apiDesign'
import type { RecordingSession } from './recordingSession'
import type { ApiDocumentation } from './apiDocumentation'

export interface Folder {
  id: RuntimeId
  name: string
  icon?: Icon
  notes?: string
  tags: string[]
  configuration: FolderConfiguration
  items: FolderItem[]
}

export interface EnvironmentFolder extends Folder {
  folderType: 'environment'
  environments: Environment[]
  tagColors?: Record<string, string>
  enumDefinitions?: EnumDefinition[]
  /** User-defined custom value lists (named label → value maps).
   * Fully user-managed via the "Variables personnalisées" tab —
   * never touched by spec re-import and not shown in the docs.
   * Absent until the user creates one. */
  customValueLists?: CustomValueList[]
  /** Structured API documentation populated by spec importers
   * (OpenAPI / AsyncAPI / GraphQL / gRPC reflection / SOAP /
   * OData). Drives the Docs tab on every request, env-folder, and
   * sub-folder under this env folder. Absent on manually-created
   * env folders. */
  apiDocumentation?: ApiDocumentation
  /** How this folder was created (swagger, grpc, graphql, etc.). Absent for manually created folders. */
  importSource?: ImportSourceType
  /**
   * Configuration for the periodic spec re-check + idempotent
   * refresh. Absent for manually created folders, and also absent on
   * legacy folders saved before the field existed — the load-time
   * migration backfills it from `apiDocumentation.sourceUrl` when
   * possible.
   */
  apiUpdate?: ApiUpdateConfig
}

export type FolderItem = Folder | EnvironmentFolder | Request | Scenario | ApiDesign | RecordingSession

export function isEnvironmentFolder(item: FolderItem): item is EnvironmentFolder {
  // Some legacy/loaded objects may omit `configuration` at runtime; detection should rely on `folderType`.
  if (!('items' in item) || !('folderType' in item)) {
    return false
  }
  return (item as { folderType: string }).folderType === 'environment'
}

export function isFolder(item: FolderItem): item is Folder {
  return 'items' in item && 'configuration' in item && !isEnvironmentFolder(item)
}

export function isAnyFolder(item: FolderItem): item is Folder | EnvironmentFolder {
  return 'items' in item && 'configuration' in item
}

export function isScenario(item: FolderItem): item is Scenario {
  return 'type' in item && (item as { type: string }).type === 'scenario'
}

export function isApiDesign(item: FolderItem): item is ApiDesign {
  return 'type' in item && (item as { type: string }).type === 'design'
}

export function isRecordingSession(item: FolderItem): item is RecordingSession {
  return 'type' in item && (item as { type: string }).type === 'recording'
}

export function isRequest(item: FolderItem): item is Request {
  // A Scenario, an ApiDesign and a RecordingSession also carry a `type`
  // (and no `items` until they hold children); exclude them so request
  // type-guards don't mis-classify any of them.
  return 'type' in item && !('items' in item) && !isScenario(item) && !isApiDesign(item) && !isRecordingSession(item)
}
