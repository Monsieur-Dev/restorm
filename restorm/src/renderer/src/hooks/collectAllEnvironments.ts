import { isEnvironmentFolder } from '../../../shared/types/folderTypes'
import type { EnvironmentFolder, FolderItem } from '../../../shared/types/folderTypes'
import { flattenEnvironments, type FlatEnvRow } from '../components/MainView/envSelectorHelpers'

/**
 * Walk the whole collection tree and collect every environment from every
 * `EnvironmentFolder` (env folders nest inside other folders), flattened with
 * the existing depth-based indentation (nested sub-environments included). Used
 * by the value selector's environment picker, which — unlike the request/status
 * pickers — isn't scoped to a single folder. Environment ids are globally
 * unique, so a flat concatenation across folders is unambiguous. Kept free of
 * store / event-bus imports so it can be unit-tested directly.
 */
export function collectAllEnvironments(collections: readonly EnvironmentFolder[]): FlatEnvRow[] {
  const rows: FlatEnvRow[] = []
  const walk = (items: readonly FolderItem[]): void => {
    for (const item of items) {
      if (isEnvironmentFolder(item)) {
        // Tag each row with its owning folder's name so the picker can render a
        // header per folder (the user can tell which folder an env belongs to).
        for (const row of flattenEnvironments(item.environments)) {
          rows.push({ ...row, groupLabel: item.name })
        }
        walk(item.items)
      } else if ('items' in item && Array.isArray((item as { items?: unknown }).items)) {
        walk((item as { items: FolderItem[] }).items)
      }
    }
  }
  walk(collections)
  return rows
}
