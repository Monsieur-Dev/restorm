import { isEnvironmentFolder } from '../../../shared/types/folderTypes'
import type { EnvironmentFolder, FolderItem } from '../../../shared/types/folderTypes'
import type { EnumDefinition, CustomValueList } from '../../../shared/types/collections'
import type { ApiDocumentation } from '../../../shared/types/apiDocumentation'
import { apiDocEnumDefinitions } from './collectAllEnvValueTypes'

/**
 * Enum + custom-value types contributed by a single environment folder (one
 * "API" in the project tree). The type-pick menu renders one submenu per group,
 * labelled with the folder's `name`.
 */
export interface EnvValueTypeGroup {
  /** Env folder id. */
  id: string
  /** Env folder display name (submenu label). */
  name: string
  /** The folder's own custom value lists. */
  customValueLists: CustomValueList[]
  /** The folder's own enum definitions plus its apiDoc enum models. */
  enumDefinitions: EnumDefinition[]
}

/**
 * apiDoc enum models for a folder, with each id namespaced by the folder id so
 * two APIs that happen to share a model name (e.g. `Status`) don't collide in
 * the flattened lookup the editor uses to resolve an `EnumValue`. The visible
 * `name` stays the bare model name.
 */
function namespacedApiDocEnums(envFolderId: string, apiDoc: ApiDocumentation | undefined): EnumDefinition[] {
  return apiDocEnumDefinitions(apiDoc).map((def) => ({ ...def, id: `${envFolderId}::${def.id}` }))
}

/**
 * Walk the whole collection tree, producing one {@link EnvValueTypeGroup} per
 * `EnvironmentFolder` node (env folders nest inside other folders). Kept free
 * of store / event-bus imports so it can be unit-tested directly.
 */
export function collectEnvValueTypeGroups(collections: readonly EnvironmentFolder[]): EnvValueTypeGroup[] {
  const groups: EnvValueTypeGroup[] = []

  const pushFrom = (env: EnvironmentFolder): void => {
    const apiDoc = (env as unknown as { apiDocumentation?: ApiDocumentation }).apiDocumentation
    groups.push({
      id: env.id,
      name: env.name,
      customValueLists: env.customValueLists ?? [],
      enumDefinitions: [...(env.enumDefinitions ?? []), ...namespacedApiDocEnums(env.id, apiDoc)]
    })
  }

  const walk = (items: readonly FolderItem[]): void => {
    for (const item of items) {
      if (isEnvironmentFolder(item)) {
        pushFrom(item)
        walk(item.items)
      } else if ('items' in item && Array.isArray((item as { items?: unknown }).items)) {
        walk((item as { items: FolderItem[] }).items)
      }
    }
  }

  walk(collections)
  return groups
}
