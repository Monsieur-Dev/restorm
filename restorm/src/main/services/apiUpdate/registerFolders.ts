import { logger } from 'electron-core-ui'
import type { EnvironmentFolder, FolderItem } from '../../../shared/types/folderTypes'
import { isAnyFolder, isEnvironmentFolder } from '../../../shared/types/folderTypes'
import type { ApiUpdateConfig, ImportSourceType } from '../../../shared/types/baseTypes'
import { apiUpdateScheduler, type ApiUpdateSchedulerFolder } from './ApiUpdateScheduler'

/**
 * Bridge between `CollectionStore` and the scheduler. Walks every
 * env folder in the project, collects the ones that have an
 * `apiUpdate` config wired up, and hands them over to the global
 * scheduler. Run at boot, after every project load, and after the
 * user edits the per-folder settings.
 */
export interface CollectFoldersInput {
  collections: EnvironmentFolder[]
  /** Persists a partial `apiUpdate` patch onto the folder identified
   * by id. Implemented by the bootstrap layer because it has the
   * `CollectionStore` in scope. */
  persistConfig: (folderId: string, patch: Partial<ApiUpdateConfig>) => void
}

function* walkEnvironmentFolders(items: FolderItem[]): Generator<EnvironmentFolder> {
  for (const item of items) {
    if (isEnvironmentFolder(item)) {
      yield item
      yield* walkEnvironmentFolders(item.items)
      continue
    }
    if (isAnyFolder(item)) yield* walkEnvironmentFolders(item.items)
  }
}

function isImportSource(value: string | undefined): value is ImportSourceType {
  if (!value) return false
  return ['swagger', 'graphql', 'grpc', 'wsdl', 'asyncapi', 'postman', 'insomnia', 'bruno', 'curl', 'powershell', 'url'].includes(value)
}

/**
 * Resolve `${VAR}` expansion variables for an env folder. The folder
 * may carry one or more `environments`; we use the first
 * environment's variables as a sensible default. The IPC layer can
 * override this on a per-call basis for "Check now" so the user can
 * pick a non-default env explicitly.
 */
function extractStringValue(v: unknown): string | undefined {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v && typeof v === 'object') {
    const obj = v as { value?: unknown; toString?: () => string }
    if (typeof obj.value === 'string') return obj.value
    if (typeof obj.value === 'number' || typeof obj.value === 'boolean') return String(obj.value)
    if (typeof obj.toString === 'function' && obj.toString !== Object.prototype.toString) {
      const out = obj.toString()
      if (out !== '[object Object]') return out
    }
  }
  return undefined
}

function defaultVariablesFor(folder: EnvironmentFolder): Record<string, string> {
  const env = folder.environments[0]
  if (!env) return {}
  const vars: Record<string, string> = {}
  for (const kv of env.variables) {
    const v = extractStringValue(kv.value)
    if (v !== undefined) vars[kv.key] = v
  }
  return vars
}

export function registerSchedulerFolders(input: CollectFoldersInput): void {
  const folders: ApiUpdateSchedulerFolder[] = []
  for (const root of input.collections) {
    for (const env of [root, ...walkEnvironmentFolders(root.items)]) {
      const config = env.apiUpdate
      if (!config) continue
      const importSource = isImportSource(env.importSource) ? env.importSource : null
      if (!importSource) continue
      folders.push({
        folderId: env.id,
        importSource,
        config,
        variables: defaultVariablesFor(env),
        onCheckCompleted: (patch) => {
          input.persistConfig(env.id, patch)
        }
      })
    }
  }
  apiUpdateScheduler.setFolders(folders)
  logger.info(`[apiUpdate.registerFolders] registered ${folders.length} folder(s) with the scheduler`)
}
