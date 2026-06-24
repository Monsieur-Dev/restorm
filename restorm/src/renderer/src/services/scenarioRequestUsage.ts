import type { FolderItem, Scenario } from '../../../shared/types/collections'
import { isScenario } from '../../../shared/types/collections'
import { REGISTRY, SCENARIO_KINDS } from '../../../shared/scenarioKindRegistry'

/**
 * Where a request is referenced by a scenario: the scenario plus the ids of its request-binding
 * (httpRequest / socketioConnect / websocketConnect) nodes bound to that request. A scenario may bind the same
 * request from several boxes, hence a list of node ids.
 */
export interface ScenarioRequestUsage {
  scenario: Scenario
  /** Request-binding node ids in this scenario whose `config.requestId` matches. */
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

/** Scenario node kinds that bind a sidebar request through `config.requestId` —
 * the one-shot `httpRequest`, the long-lived streaming connect nodes (Socket.IO /
 * raw WebSocket / MQTT / gRPC), and the HTTP / SOAP mock-server `httpListen` /
 * `soapListen` (bound to a `server: true` request). DERIVED from the kind registry's `requestBinding` flag
 * (the single source of truth) so a request ties to the scenario for BOTH the
 * "used in scenarios" reverse-nav and the delete → move-into-scenario flow. (A
 * kind like `httpClose` binds a `connectionNodeId`, not a request, so its
 * `requestBinding` is unset and it is excluded.) */
const REQUEST_BINDING_KINDS: ReadonlySet<string> = new Set(
  SCENARIO_KINDS.filter((k) => REGISTRY[k].requestBinding === true)
)

/** Whether a scenario node binds `requestId` (via `config.requestId`). */
function nodeBindsRequest(node: { kind: string; config: Record<string, unknown> }, requestId: string): boolean {
  return REQUEST_BINDING_KINDS.has(node.kind) && node.config['requestId'] === requestId
}

/**
 * Every scenario (across all projects) that references `requestId` through a
 * request-binding node, with the matching node ids. Drives the request editor's
 * "used in scenarios" reverse-navigation button. Computed live from the tree,
 * so deleting a scenario (or a node) updates the result with no stored
 * back-reference to maintain.
 */
export function findScenariosUsingRequest(rootItems: FolderItem[], requestId: string): ScenarioRequestUsage[] {
  const out: ScenarioRequestUsage[] = []
  walkScenarios(rootItems, (scenario) => {
    const nodeIds = scenario.nodes
      .filter((n) => nodeBindsRequest(n, requestId))
      .map((n) => n.id)
    if (nodeIds.length > 0) out.push({ scenario, nodeIds })
  })
  return out
}

/**
 * Every scenario (across all projects) whose request-binding nodes reference a
 * saved quick-config by id (`config.quickConfigId`). Drives the quick-settings
 * delete-confirmation cross-link: deleting a config that one or more scenario
 * actions use names those scenarios so the user knows what they'll orphan.
 * Computed live from the tree (no stored back-reference) so a deleted scenario
 * or node drops out of the result automatically. Each entry carries the
 * matching node ids; the caller dedups by scenario.
 */
export function findScenariosUsingQuickConfig(rootItems: FolderItem[], quickConfigId: string): ScenarioRequestUsage[] {
  const out: ScenarioRequestUsage[] = []
  walkScenarios(rootItems, (scenario) => {
    const nodeIds = scenario.nodes
      .filter((n) => REQUEST_BINDING_KINDS.has(n.kind) && n.config['quickConfigId'] === quickConfigId)
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
      // A NESTED scenario owns its own children — a request authored inside it
      // belongs to THAT scenario, not to this ancestor. Stop at the boundary so
      // a request in `Main / Sub` isn't reported as belonging to both `Sub` and
      // `Main` (which over-warned in the delete dialog). Plain folders /
      // env-folders are not scenario boundaries, so we still descend them.
      if (isScenario(item)) continue
      if ('items' in item && Array.isArray((item as { items?: unknown }).items)) {
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
 * through request-binding nodes (`nodeIds`), holds it in its subtree
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
      .filter((n) => nodeBindsRequest(n, requestId))
      .map((n) => n.id)
    const inSubtree = isRequestInScenarioSubtree(scenario, requestId)
    if (nodeIds.length > 0 || inSubtree) out.push({ scenario, nodeIds, inSubtree })
  })
  return out
}

/**
 * The scenarios whose deletion dialog should fire when deleting `requestId`:
 * ONLY those that BIND it through a box (`nodeIds` non-empty). A request that
 * merely lives inside a scenario's folder subtree but is wired into no box is
 * NOT a usage — deleting it just removes a filed-away request, so it must not
 * raise the "used in scenarios" dialog. Each kept entry still carries
 * `inSubtree` so the dialog can offer move-in vs strip-box per scenario.
 */
export function requestScenarioDeleteUsages(rootItems: FolderItem[], requestId: string): ScenarioRequestRelation[] {
  return collectRequestScenarioRelations(rootItems, requestId).filter((r) => r.nodeIds.length > 0)
}
