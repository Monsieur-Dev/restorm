import type { Environment, EnvironmentFolder, FolderItem } from '../../../shared/types/collections'
import { isEnvironmentFolder } from '../../../shared/types/collections'

/**
 * Save-unit resolution for environments.
 *
 * `EnvironmentFolder.environments` is `@separateFolders` — each TOP-LEVEL
 * environment is its own save-unit. `Environment.subEnvironments`, by contrast,
 * carries NO decorator, so a sub-environment lives embedded inside its
 * top-level env's content and is NOT a save-unit of its own. A change to a
 * sub-environment must therefore mark the TOP-LEVEL env's unit dirty — never a
 * phantom per-sub-env unit the save decomposer never produces (that phantom can
 * never be committed, which leaves the document permanently dirty and the
 * change unsaved despite autosave).
 *
 * These helpers map any environment id to its top-level owner so the save-unit
 * bridge can redirect sub-env events onto the right unit.
 */

/** Does `env` itself, or any of its nested sub-environments, have `targetId`? */
function envSubtreeContains(env: Environment, targetId: string): boolean {
  if (env.id === targetId) return true
  return env.subEnvironments?.some((child) => envSubtreeContains(child, targetId)) ?? false
}

/** Find an environment folder by id anywhere in the tree. */
function findEnvironmentFolderById(items: FolderItem[], id: string): EnvironmentFolder | null {
  for (const item of items) {
    if (isEnvironmentFolder(item) && item.id === id) return item
    if ('items' in item) {
      const found = findEnvironmentFolderById((item as { items: FolderItem[] }).items, id)
      if (found) return found
    }
  }
  return null
}

/**
 * Resolve the TOP-LEVEL environment (a direct child of env-folder
 * `envFolderId`) whose subtree owns `targetEnvId`. Returns the env itself when
 * `targetEnvId` IS a top-level env, the top-level ancestor when it's a
 * sub-environment, or `null` when the folder / env can't be found.
 */
export function findTopLevelEnvironment(
  rootItems: FolderItem[],
  envFolderId: string,
  targetEnvId: string
): Environment | null {
  const folder = findEnvironmentFolderById(rootItems, envFolderId)
  if (!folder) return null
  for (const topEnv of folder.environments) {
    if (envSubtreeContains(topEnv, targetEnvId)) return topEnv
  }
  return null
}
