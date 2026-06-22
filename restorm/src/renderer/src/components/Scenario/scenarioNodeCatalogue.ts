import type { ScenarioNodeKind } from '../../../../shared/types/collections'
import type { ScenarioNodeCategory } from '../../../../shared/scenarioKindRegistry'
import { SCENARIO_KIND_REGISTRY } from '../../../../shared/scenarioKindRegistry'

/**
 * Presentation metadata for the scenario node catalogue (epic §5). The
 * catalogue + the node box header (label + codicon) are now DERIVED from the
 * kind registry (the single source of truth) in registry key order — adding a
 * kind to the registry makes it appear in the palette automatically, grouped by
 * its `category`.
 */

// ScenarioNodeCategory moved to the kind registry; re-exported for back-compat.
export type { ScenarioNodeCategory } from '../../../../shared/scenarioKindRegistry'

/** Categories rendered as a nested submenu in the add-node menu + link palette
 * (label + icon), instead of a flat separator-delimited group. Keyed off the
 * catalogue category so a new kind joins its submenu automatically. */
export const SCENARIO_SUBMENU_CATEGORIES: Partial<Record<ScenarioNodeCategory, { labelKey: string; defaultLabel: string; icon: string }>> = {
  lists: { labelKey: 'scenario.menuGroups.lists', defaultLabel: 'Lists', icon: 'list-unordered' },
  loops: { labelKey: 'scenario.nodes.loops', defaultLabel: 'Loops', icon: 'sync' },
  time: { labelKey: 'scenario.menuGroups.time', defaultLabel: 'Timing', icon: 'watch' },
  math: { labelKey: 'scenario.menuGroups.math', defaultLabel: 'Math', icon: 'symbol-operator' },
  algorithmie: { labelKey: 'scenario.menuGroups.algorithmie', defaultLabel: 'Algorithmie', icon: 'symbol-misc' },
  dataFormats: { labelKey: 'scenario.menuGroups.dataFormats', defaultLabel: 'Data formats', icon: 'file-code' },
  encoding: { labelKey: 'scenario.menuGroups.encoding', defaultLabel: 'Encoding', icon: 'lock' },
  ux: { labelKey: 'scenario.menuGroups.ux', defaultLabel: 'UX', icon: 'bell' }
}

export interface ScenarioNodeKindMeta {
  kind: ScenarioNodeKind
  /** i18n key under `scenario.nodes.*`, falling back to `defaultLabel`. */
  labelKey: string
  defaultLabel: string
  /** Codicon glyph shown on the node header + palette entry. */
  icon: string
  /** Group the kind belongs to (separators in the add-node menu). */
  category: ScenarioNodeCategory
}

/** Ordered catalogue — derived from the kind registry in its key order (which is
 * authored to mirror the epic's §5 sections), so the palette grouping is exactly
 * the registry's declaration order. */
export const SCENARIO_NODE_CATALOGUE: ScenarioNodeKindMeta[] = (
  Object.entries(SCENARIO_KIND_REGISTRY) as [ScenarioNodeKind, (typeof SCENARIO_KIND_REGISTRY)[ScenarioNodeKind]][]
).map(([kind, spec]) => ({
  kind,
  labelKey: spec.labelKey,
  defaultLabel: spec.defaultLabel,
  icon: spec.icon,
  category: spec.category
}))

const byKind = new Map(SCENARIO_NODE_CATALOGUE.map((m) => [m.kind, m]))

/** Catalogue metadata for a kind (falls back to a generic entry). */
export function scenarioNodeMeta(kind: ScenarioNodeKind): ScenarioNodeKindMeta {
  return byKind.get(kind) ?? { kind, labelKey: `scenario.nodes.${kind}`, defaultLabel: kind, icon: 'circle-outline', category: 'utility' }
}
