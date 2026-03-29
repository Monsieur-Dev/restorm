/**
 * Helper functions for checksum tracking
 */

import type { EnvironmentFolder, Folder, Environment, FolderItem } from '../../../shared/types/collections'
import { isEnvironmentFolder, isAnyFolder } from '../../../shared/types/collections'

/**
 * Collect all objects (folders, requests, environments) with their runtimeIds for checksum tracking.
 * This creates a Map that can be passed to registerInitialChecksums.
 */
export function collectAllObjectsForChecksums(folders: EnvironmentFolder[]): Map<string, unknown> {
  const objects = new Map<string, unknown>()

  function collectEnvironments(env: Environment): void {
    // Store the environment object directly - serialization happens later
    // This matches the format used in reactive.ts events: JSON.parse(JSON.stringify(env))
    objects.set(env.id, env)

    // Recursively collect sub-environments
    if (env.subEnvironments) {
      for (const subEnv of env.subEnvironments) {
        collectEnvironments(subEnv)
      }
    }
  }

  function collectFromFolder(folder: Folder | EnvironmentFolder): void {
    // Store the folder object directly - serialization happens later
    // This matches the format used in reactive.ts events: JSON.parse(JSON.stringify(folder))
    objects.set(folder.id, folder)

    // If it's an environment folder, collect its environments
    if (isEnvironmentFolder(folder as FolderItem)) {
      const envFolder = folder as EnvironmentFolder
      for (const env of envFolder.environments) {
        collectEnvironments(env)
      }
    }

    // Collect items (requests and sub-folders)
    for (const item of folder.items) {
      if (isAnyFolder(item)) {
        collectFromFolder(item)
      } else {
        // Store the request object directly - serialization happens later
        objects.set(item.id, item)
      }
    }
  }

  for (const folder of folders) {
    collectFromFolder(folder)
  }

  return objects
}
