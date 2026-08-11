/**
 * Project-backed resolvers for the two scenario value types that can't be
 * rendered from their persisted form alone — a `customList` (label → value) and
 * an `environment` (id → `{ name, variables }`). Both the renderer (live store)
 * and the headless engine (loaded project) install these via
 * {@link installScenarioValueResolvers} so `concreteValue` resolves them to
 * their real value EVERYWHERE — UI preview and headless run alike — instead of
 * the bare label / an opaque `{{$id}}` template.
 */
import type { FolderItem } from './types/folderTypes'
import { isEnvironmentFolder } from './types/folderTypes'
import type { Environment, CustomValueList, EnumDefinition } from './types/baseTypes'
import { concreteValue, setCustomListResolver, setEnvironmentPreviewResolver } from './utils/scenarioStaticPreview'
import { setEnumValuesResolver, setEnvironmentIdResolver } from './scenarioCliParams'

/** Walk a collection tree, collecting every custom value list (they live on
 * EnvironmentFolders, which can nest inside ordinary folders). */
function collectCustomValueLists(items: readonly FolderItem[]): CustomValueList[] {
  const out: CustomValueList[] = []
  const walk = (nodes: readonly FolderItem[]): void => {
    for (const item of nodes) {
      if (isEnvironmentFolder(item)) {
        if (item.customValueLists) out.push(...item.customValueLists)
        walk(item.items)
      } else if ('items' in item && Array.isArray((item as { items?: unknown }).items)) {
        walk((item as { items: FolderItem[] }).items)
      }
    }
  }
  walk(items)
  return out
}

/** Walk a collection tree, collecting every environment (including nested
 * `subEnvironments`), keyed by id. */
function collectEnvironmentsById(items: readonly FolderItem[]): Map<string, Environment> {
  const map = new Map<string, Environment>()
  const addEnv = (env: Environment): void => {
    map.set(env.id, env)
    for (const sub of env.subEnvironments ?? []) addEnv(sub)
  }
  const walk = (nodes: readonly FolderItem[]): void => {
    for (const item of nodes) {
      if (isEnvironmentFolder(item)) {
        for (const env of item.environments) addEnv(env)
        walk(item.items)
      } else if ('items' in item && Array.isArray((item as { items?: unknown }).items)) {
        walk((item as { items: FolderItem[] }).items)
      }
    }
  }
  walk(items)
  return map
}

/** Walk a collection tree, collecting every enum definition (they live on
 * EnvironmentFolders). */
function collectEnumDefinitions(items: readonly FolderItem[]): EnumDefinition[] {
  const out: EnumDefinition[] = []
  const walk = (nodes: readonly FolderItem[]): void => {
    for (const item of nodes) {
      if (isEnvironmentFolder(item)) {
        if (item.enumDefinitions) out.push(...item.enumDefinitions)
        walk(item.items)
      } else if ('items' in item && Array.isArray((item as { items?: unknown }).items)) {
        walk((item as { items: FolderItem[] }).items)
      }
    }
  }
  walk(items)
  return out
}

/** The value behind a custom-list label (enabled entries only), or `undefined`
 * when the list / label is unknown. */
function findCustomListValue(lists: readonly CustomValueList[], listId: string, label: string): string | undefined {
  const list = lists.find((l) => l.id === listId)
  return list?.entries.find((e) => e.label === label && e.enabled !== false)?.value
}

/** Resolve an environment NAME or id to its id. An exact id wins; otherwise a
 * unique name match; an ambiguous name (or unknown token) THROWS. */
function resolveEnvironmentId(envs: Map<string, Environment>, token: string): string {
  if (envs.has(token)) return token
  const byName = [...envs.values()].filter((e) => e.name === token)
  const first = byName[0]
  if (byName.length === 1 && first !== undefined) return first.id
  if (byName.length > 1) {
    throw new Error(`ambiguous environment '${token}' — ${byName.length} environments share that name; pass the environment id instead`)
  }
  throw new Error(`unknown environment '${token}' — no environment with that name or id`)
}

/** The runtime/preview form of an environment value: `{ name, variables }`
 * (variables omitted when empty), mirroring the renderer resolver + the runtime
 * `conditionEval.resolveOperand`. */
function environmentResolvedValue(env: Environment): unknown {
  const variables: Record<string, unknown> = {}
  for (const kv of env.variables) {
    if (typeof kv.key === 'string' && kv.key.length > 0) variables[kv.key] = concreteValue(kv.value)
  }
  return Object.keys(variables).length > 0 ? { name: env.name, variables } : { name: env.name }
}

/**
 * Install the custom-list + environment resolvers from a collection source.
 * `getCollections` is read on EVERY resolve so live edits (renderer) or a
 * freshly loaded project (headless) are tracked without re-registering.
 */
export function installScenarioValueResolvers(getCollections: () => readonly FolderItem[]): void {
  setCustomListResolver((listId, label) => findCustomListValue(collectCustomValueLists(getCollections()), listId, label))
  setEnvironmentPreviewResolver((envId) => {
    const env = collectEnvironmentsById(getCollections()).get(envId)
    return env !== undefined ? environmentResolvedValue(env) : undefined
  })
  // CLI `--param` casts: validate enum values + resolve an environment name→id.
  setEnumValuesResolver((enumDefinitionId) => collectEnumDefinitions(getCollections()).find((d) => d.id === enumDefinitionId)?.values)
  setEnvironmentIdResolver((token) => resolveEnvironmentId(collectEnvironmentsById(getCollections()), token))
}
