/**
 * Deleting a CONTAINER (folder / environment folder / scenario) deletes its
 * whole subtree — including requests that scenario boxes elsewhere still
 * bind. Each such request must go through the same "used by scenarios"
 * dialog as a direct request deletion (move it into the scenario, or delete
 * anyway and strip the boxes), one request at a time.
 *
 * The ONLY case that needs no prompt is a self-contained deletion: when the
 * binding scenario dies in the SAME subtree as the request it binds, there
 * is nobody left to dangle — so usages from scenarios inside the deleted
 * subtree are filtered out.
 */

import type { FolderItem } from '../../../shared/types/collections'
import { isRequest } from '../../../shared/types/collections'
import { findItemById } from '../utils/treeSearch'
import { requestScenarioDeleteUsages } from './scenarioRequestUsage'
import type { RequestScenarioDeleteUsage } from '../components/Modals/RequestScenarioDeleteModal'

export interface ContainerDeleteAffectedRequest {
  requestId: string
  requestName: string
  usages: RequestScenarioDeleteUsage[]
}

/** Depth-first list of the requests in `containerId`'s subtree that are
 * bound by scenarios OUTSIDE that subtree. Empty for a request id (direct
 * request deletion has its own flow) or an unknown id. */
export function collectSubtreeScenarioUsages(
  rootItems: FolderItem[],
  containerId: string
): ContainerDeleteAffectedRequest[] {
  const container = findItemById(rootItems, containerId)
  if (!container || isRequest(container)) return []

  const subtreeIds = new Set<string>()
  const collectIds = (item: FolderItem): void => {
    subtreeIds.add(item.id)
    for (const child of ((item as { items?: FolderItem[] }).items ?? [])) collectIds(child)
  }
  collectIds(container)

  const out: ContainerDeleteAffectedRequest[] = []
  const walk = (item: FolderItem): void => {
    if (isRequest(item)) {
      const usages = requestScenarioDeleteUsages(rootItems, item.id)
        .filter((u) => !subtreeIds.has(u.scenario.id))
        .map((u): RequestScenarioDeleteUsage => ({
          scenarioId: u.scenario.id,
          scenarioName: u.scenario.name,
          inSubtree: u.inSubtree
        }))
      if (usages.length > 0) out.push({ requestId: item.id, requestName: item.name, usages })
    }
    for (const child of ((item as { items?: FolderItem[] }).items ?? [])) walk(child)
  }
  walk(container)
  return out
}
