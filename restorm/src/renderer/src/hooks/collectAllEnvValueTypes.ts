import { isEnvironmentFolder } from '../../../shared/types/folderTypes'
import type { EnvironmentFolder, FolderItem } from '../../../shared/types/folderTypes'
import type { EnumDefinition, CustomValueList } from '../../../shared/types/collections'
import type { ApiDocumentation } from '../../../shared/types/apiDocumentation'
import { isEnumModel } from '../components/documentation/enumGroups'

export interface AllEnvValueTypes {
  enumDefinitions: EnumDefinition[]
  customValueLists: CustomValueList[]
}

function formatEnumValue(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

/**
 * API-defined enum types for a folder: the `apiDocumentation` models that are
 * themselves enums (a schema with `enumValues` and no properties, e.g.
 * `AccountStatus`). These are the "types issus de l'API" — exposed as
 * selectable enum types alongside the folder's own `enumDefinitions` (a
 * separate, often-empty supplement) and custom value lists. Keyed by the model
 * name so an `EnumValue` can reference it by `enumDefinitionId`.
 */
export function apiDocEnumDefinitions(apiDoc: ApiDocumentation | undefined): EnumDefinition[] {
  if (!apiDoc?.models) return []
  return Object.values(apiDoc.models)
    .filter(isEnumModel)
    .map((m) => ({ id: m.name, name: m.name, values: (m.enumValues ?? []).map(formatEnumValue), matchingRules: [] }))
}

/** All selectable enum definitions for an env folder: its own `enumDefinitions`
 * plus the API-defined enum models from `apiDocumentation`. */
export function enumDefinitionsForEnvFolder(env: EnvironmentFolder): EnumDefinition[] {
  const apiDoc = (env as unknown as { apiDocumentation?: ApiDocumentation }).apiDocumentation
  return [...(env.enumDefinitions ?? []), ...apiDocEnumDefinitions(apiDoc)]
}

/**
 * Walk the whole collection tree, collecting enum definitions + custom value
 * lists from every `EnvironmentFolder` node (env folders nest inside other
 * folders), concatenated and de-duplicated by id. Kept free of store / event
 * bus imports so it can be unit-tested directly.
 */
export function collectAllEnvValueTypes(collections: readonly EnvironmentFolder[]): AllEnvValueTypes {
  const enums: EnumDefinition[] = []
  const lists: CustomValueList[] = []
  const seenEnums = new Set<string>()
  const seenLists = new Set<string>()

  const pushFrom = (env: EnvironmentFolder): void => {
    for (const def of enumDefinitionsForEnvFolder(env)) {
      if (seenEnums.has(def.id)) continue
      seenEnums.add(def.id)
      enums.push(def)
    }
    for (const list of env.customValueLists ?? []) {
      if (seenLists.has(list.id)) continue
      seenLists.add(list.id)
      lists.push(list)
    }
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
  return { enumDefinitions: enums, customValueLists: lists }
}
