import { collectionStore } from '../services/CollectionStore'
import { isScenario } from '../../shared/types/folderTypes'
import { resolveRunTarget } from '../../shared/scenarioRunTarget'
import type { FolderItem } from '../../shared/types/collections'

/** Either the resolved scenario id, or a human-readable error to print. */
export type ResolveScenarioResult = { id: string } | { error: string }

/**
 * Resolve a CLI `--run` target to a scenario id. By id is a direct store lookup.
 * By name accepts the bare name, the full breadcrumb, or the folder-mode index
 * path (see `resolveRunTarget`) — and errors EXPLICITLY when the target is
 * ambiguous (≥2 scenarios match) so the run crashes loudly with a non-zero exit.
 */
export function resolveScenarioTarget(target: string, by: 'name' | 'id'): ResolveScenarioResult {
  if (by === 'id') {
    const item = collectionStore.findById(target)
    if (!item || !isScenario(item)) return { error: `no scenario with id '${target}'` }
    return { id: target }
  }
  return resolveRunTarget(collectionStore.getCollections() as unknown as FolderItem[], target)
}
