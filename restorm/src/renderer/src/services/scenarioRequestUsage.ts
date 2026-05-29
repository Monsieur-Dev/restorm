import type { FolderItem, Scenario } from '../../../shared/types/collections'
import { isScenario } from '../../../shared/types/collections'

/**
 * Where a request is referenced by a scenario: the scenario plus the ids of its
 * `httpRequest` nodes bound to that request. A scenario may bind the same
 * request from several boxes, hence a list of node ids.
 */
export interface ScenarioRequestUsage {
  scenario: Scenario
  /** `httpRequest` node ids in this scenario whose `config.requestId` matches. */
  nodeIds: string[]
}

/** Descend into every container (folder / env-folder / scenario subtree),
 * visiting each scenario found. Env-folders are walked too — a request can be
 * dragged onto a scenario from anywhere — so we test `'items'` presence rather
 * than `isAnyFolder` (which excludes env-folders). */
function walkScenarios(items: FolderItem[], visit: (scenario: Scenario) => void): void {
  for (const item of items) {
    if (isScenario(item)) {
      visit(item)
      if (item.items) walkScenarios(item.items, visit)
    } else if ('items' in item && Array.isArray((item as { items?: unknown }).items)) {
      walkScenarios((item as { items: FolderItem[] }).items, visit)
    }
  }
}

/**
 * Every scenario (across all projects) that references `requestId` through an
 * `httpRequest` node, with the matching node ids. Drives the request editor's
 * "used in scenarios" reverse-navigation button. Computed live from the tree,
 * so deleting a scenario (or a node) updates the result with no stored
 * back-reference to maintain.
 */
export function findScenariosUsingRequest(rootItems: FolderItem[], requestId: string): ScenarioRequestUsage[] {
  const out: ScenarioRequestUsage[] = []
  walkScenarios(rootItems, (scenario) => {
    const nodeIds = scenario.nodes
      .filter((n) => n.kind === 'httpRequest' && n.config['requestId'] === requestId)
      .map((n) => n.id)
    if (nodeIds.length > 0) out.push({ scenario, nodeIds })
  })
  return out
}

/** Whether `requestId` lives inside `scenario`'s own subtree (it was authored
 * as a child of the scenario, as opposed to referenced from elsewhere). Decides
 * the request-deletion flow: a child request warns it will affect the scenario;
 * an external one offers to move it in or drop the binding. */
export function isRequestInScenarioSubtree(scenario: Scenario, requestId: string): boolean {
  const walk = (items: FolderItem[] | undefined): boolean => {
    if (!items) return false
    for (const item of items) {
      if (item.id === requestId) return true
      if (isScenario(item)) {
        if (walk(item.items)) return true
      } else if ('items' in item && Array.isArray((item as { items?: unknown }).items)) {
        if (walk((item as { items: FolderItem[] }).items)) return true
      }
    }
    return false
  }
  return walk(scenario.items)
}

/**
 * Where a scenario is referenced by another scenario: the caller plus the ids
 * of its `runScenario` nodes whose `config.scenarioId` matches. Used by the
 * scenario editor's "callers" reverse-nav button (mirror of the request one).
 */
export interface ScenarioScenarioUsage {
  scenario: Scenario
  /** `runScenario` node ids in this caller whose `config.scenarioId` matches. */
  nodeIds: string[]
}

/**
 * Every scenario that references `subScenarioId` through a `runScenario` node.
 * Excludes the scenario itself (a self-call shouldn't surface in the list of
 * "scenarios calling this one"; the user is already on it).
 */
export function findScenariosUsingScenario(rootItems: FolderItem[], subScenarioId: string): ScenarioScenarioUsage[] {
  const out: ScenarioScenarioUsage[] = []
  walkScenarios(rootItems, (scenario) => {
    if (scenario.id === subScenarioId) return
    const nodeIds = scenario.nodes
      .filter((n) => n.kind === 'runScenario' && n.config['scenarioId'] === subScenarioId)
      .map((n) => n.id)
    if (nodeIds.length > 0) out.push({ scenario, nodeIds })
  })
  return out
}

/** A scenario's relationship to a request being deleted: it binds the request
 * through `httpRequest` nodes (`nodeIds`), holds it in its subtree
 * (`inSubtree`), or both. Drives the deletion dialog. */
export interface ScenarioRequestRelation {
  scenario: Scenario
  nodeIds: string[]
  inSubtree: boolean
}

/** Every scenario affected by deleting `requestId` — either because a box binds
 * it, or because it lives in the scenario's subtree (a child request with no
 * box still belongs to the scenario, so deleting it affects it). Used by the
 * request-deletion flow; the reverse-nav button uses the narrower
 * {@link findScenariosUsingRequest} (boxes only). */
export function collectRequestScenarioRelations(rootItems: FolderItem[], requestId: string): ScenarioRequestRelation[] {
  const out: ScenarioRequestRelation[] = []
  walkScenarios(rootItems, (scenario) => {
    const nodeIds = scenario.nodes
      .filter((n) => n.kind === 'httpRequest' && n.config['requestId'] === requestId)
      .map((n) => n.id)
    const inSubtree = isRequestInScenarioSubtree(scenario, requestId)
    if (nodeIds.length > 0 || inSubtree) out.push({ scenario, nodeIds, inSubtree })
  })
  return out
}
