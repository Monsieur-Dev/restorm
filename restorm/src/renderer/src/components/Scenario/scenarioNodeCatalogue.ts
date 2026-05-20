import type { ScenarioNodeKind } from '../../../../shared/types/collections'

/**
 * Presentation metadata for the scenario node catalogue (epic §5). The
 * runtime/port contracts grow per-kind in later slices; this drives the
 * add-node palette + the node box header (label + codicon).
 */
export interface ScenarioNodeKindMeta {
  kind: ScenarioNodeKind
  /** i18n key under `scenario.nodes.*`, falling back to `defaultLabel`. */
  labelKey: string
  defaultLabel: string
  /** Codicon glyph shown on the node header + palette entry. */
  icon: string
}

/** Ordered catalogue, grouped to mirror the epic's §5 sections. */
export const SCENARIO_NODE_CATALOGUE: ScenarioNodeKindMeta[] = [
  // Sources & control
  { kind: 'start', labelKey: 'scenario.nodes.start', defaultLabel: 'Start', icon: 'play-circle' },
  { kind: 'input', labelKey: 'scenario.nodes.input', defaultLabel: 'Input / Param', icon: 'symbol-parameter' },
  { kind: 'if', labelKey: 'scenario.nodes.if', defaultLabel: 'If', icon: 'git-compare' },
  { kind: 'switch', labelKey: 'scenario.nodes.switch', defaultLabel: 'Switch', icon: 'list-tree' },
  // Requests & composition
  { kind: 'request', labelKey: 'scenario.nodes.request', defaultLabel: 'Request', icon: 'globe' },
  { kind: 'runScenario', labelKey: 'scenario.nodes.runScenario', defaultLabel: 'Run scenario', icon: 'circuit-board' },
  // Iteration & collections
  { kind: 'forEach', labelKey: 'scenario.nodes.forEach', defaultLabel: 'ForEach', icon: 'symbol-array' },
  { kind: 'aggregate', labelKey: 'scenario.nodes.aggregate', defaultLabel: 'Aggregate', icon: 'combine' },
  { kind: 'map', labelKey: 'scenario.nodes.map', defaultLabel: 'Map', icon: 'arrow-swap' },
  { kind: 'filter', labelKey: 'scenario.nodes.filter', defaultLabel: 'Filter', icon: 'filter' },
  // Time
  { kind: 'wait', labelKey: 'scenario.nodes.wait', defaultLabel: 'Wait', icon: 'watch' },
  { kind: 'waitUntil', labelKey: 'scenario.nodes.waitUntil', defaultLabel: 'Wait until', icon: 'clock' },
  { kind: 'now', labelKey: 'scenario.nodes.now', defaultLabel: 'Now', icon: 'calendar' },
  // Data & compute
  { kind: 'arithmetic', labelKey: 'scenario.nodes.arithmetic', defaultLabel: 'Arithmetic', icon: 'symbol-operator' },
  { kind: 'comparator', labelKey: 'scenario.nodes.comparator', defaultLabel: 'Comparator', icon: 'equals' },
  { kind: 'boolean', labelKey: 'scenario.nodes.boolean', defaultLabel: 'Boolean', icon: 'symbol-boolean' },
  { kind: 'template', labelKey: 'scenario.nodes.template', defaultLabel: 'Template', icon: 'symbol-string' },
  { kind: 'setVariable', labelKey: 'scenario.nodes.setVariable', defaultLabel: 'Set variable', icon: 'symbol-variable' },
  { kind: 'getVariable', labelKey: 'scenario.nodes.getVariable', defaultLabel: 'Get variable', icon: 'symbol-variable' },
  { kind: 'transform', labelKey: 'scenario.nodes.transform', defaultLabel: 'Transform', icon: 'json' },
  // Utilities
  { kind: 'log', labelKey: 'scenario.nodes.log', defaultLabel: 'Log', icon: 'output' },
  { kind: 'assert', labelKey: 'scenario.nodes.assert', defaultLabel: 'Assert', icon: 'verified' }
]

const byKind = new Map(SCENARIO_NODE_CATALOGUE.map((m) => [m.kind, m]))

/** Catalogue metadata for a kind (falls back to a generic entry). */
export function scenarioNodeMeta(kind: ScenarioNodeKind): ScenarioNodeKindMeta {
  return byKind.get(kind) ?? { kind, labelKey: `scenario.nodes.${kind}`, defaultLabel: kind, icon: 'circle-outline' }
}
