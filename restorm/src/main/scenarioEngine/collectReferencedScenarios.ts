/**
 * Collect deep copies of every scenario a run references — the main
 * scenario plus every sub-scenario reachable through `runScenario` nodes,
 * transitively, whether or not it actually executed. Deduped by id and
 * cycle-guarded. Used to snapshot the run-time scenario state into the
 * persisted run history.
 */
import { collectionStore } from '../services/CollectionStore'
import { isScenario } from '../../shared/types/collections'
import type { Scenario } from '../../shared/types/scenario'
import type { ScenarioRunSnapshot } from '../../shared/types/scenarioRunHistory'

function snapshot(scenario: Scenario): ScenarioRunSnapshot {
  // Deep copy so later edits to the live scenario can't mutate the
  // captured run-time state.
  const raw = scenario as unknown as { id: string; name: string; nodes?: unknown[]; edges?: unknown[]; config?: unknown }
  return JSON.parse(JSON.stringify({
    id: raw.id,
    name: raw.name,
    nodes: raw.nodes ?? [],
    edges: raw.edges ?? [],
    ...(raw.config !== undefined ? { config: raw.config } : {})
  })) as ScenarioRunSnapshot
}

export function collectReferencedScenarios(rootScenarioId: string): ScenarioRunSnapshot[] {
  const out: ScenarioRunSnapshot[] = []
  const seen = new Set<string>()

  const visit = (id: string): void => {
    if (seen.has(id)) return
    seen.add(id)
    const item = collectionStore.findById(id)
    if (!item || !isScenario(item)) return
    const scenario = item as unknown as Scenario
    out.push(snapshot(scenario))
    for (const node of scenario.nodes) {
      if (node.kind !== 'runScenario') continue
      const cfg = node.config as { scenarioId?: unknown }
      const subId = typeof cfg.scenarioId === 'string' ? cfg.scenarioId : ''
      // `param:`-prefixed targets are runtime-resolved (the sub-scenario
      // is chosen by a wired input), so they aren't statically known.
      if (subId && !subId.startsWith('param:')) visit(subId)
    }
  }

  visit(rootScenarioId)
  return out
}
