import type { ScenarioNodeKind } from '../../../../shared/types/collections'

/**
 * Presentation metadata for the scenario node catalogue (epic §5). The
 * runtime/port contracts grow per-kind in later slices; this drives the
 * add-node palette + the node box header (label + codicon).
 */
/** Catalogue grouping — drives the separators in the add-node menu. */
export type ScenarioNodeCategory = 'control' | 'composition' | 'collections' | 'loops' | 'time' | 'compute' | 'utility'

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

/** Ordered catalogue, grouped to mirror the epic's §5 sections. */
export const SCENARIO_NODE_CATALOGUE: ScenarioNodeKindMeta[] = [
  // Sources & control
  { kind: 'input', labelKey: 'scenario.nodes.input', defaultLabel: 'Input / Param', icon: 'symbol-parameter', category: 'control' },
  { kind: 'output', labelKey: 'scenario.nodes.output', defaultLabel: 'Output / Return', icon: 'export', category: 'control' },
  { kind: 'if', labelKey: 'scenario.nodes.if', defaultLabel: 'If', icon: 'git-compare', category: 'control' },
  { kind: 'switch', labelKey: 'scenario.nodes.switch', defaultLabel: 'Switch', icon: 'list-tree', category: 'control' },
  // Requests & composition
  { kind: 'httpRequest', labelKey: 'scenario.nodes.httpRequest', defaultLabel: 'HTTP Request', icon: 'globe', category: 'composition' },
  { kind: 'runScenario', labelKey: 'scenario.nodes.runScenario', defaultLabel: 'Run scenario', icon: 'circuit-board', category: 'composition' },
  // Collections
  { kind: 'aggregate', labelKey: 'scenario.nodes.aggregate', defaultLabel: 'Aggregate', icon: 'combine', category: 'collections' },
  { kind: 'map', labelKey: 'scenario.nodes.map', defaultLabel: 'Map', icon: 'arrow-swap', category: 'collections' },
  { kind: 'filter', labelKey: 'scenario.nodes.filter', defaultLabel: 'Filter', icon: 'filter', category: 'collections' },
  { kind: 'addToList', labelKey: 'scenario.nodes.addToList', defaultLabel: 'Add to list', icon: 'diff-added', category: 'collections' },
  { kind: 'removeFromList', labelKey: 'scenario.nodes.removeFromList', defaultLabel: 'Remove from list', icon: 'diff-removed', category: 'collections' },
  // Loops (grouped into a "loops" submenu in the add-node menu)
  { kind: 'forEach', labelKey: 'scenario.nodes.forEach', defaultLabel: 'ForEach', icon: 'symbol-array', category: 'loops' },
  { kind: 'for', labelKey: 'scenario.nodes.for', defaultLabel: 'For', icon: 'list-ordered', category: 'loops' },
  { kind: 'while', labelKey: 'scenario.nodes.while', defaultLabel: 'While', icon: 'sync', category: 'loops' },
  { kind: 'doWhile', labelKey: 'scenario.nodes.doWhile', defaultLabel: 'Do…While', icon: 'debug-restart', category: 'loops' },
  // Time
  { kind: 'wait', labelKey: 'scenario.nodes.wait', defaultLabel: 'Wait', icon: 'watch', category: 'time' },
  { kind: 'waitUntil', labelKey: 'scenario.nodes.waitUntil', defaultLabel: 'Wait until', icon: 'clock', category: 'time' },
  { kind: 'now', labelKey: 'scenario.nodes.now', defaultLabel: 'Now', icon: 'calendar', category: 'time' },
  // Data & compute
  { kind: 'arithmetic', labelKey: 'scenario.nodes.arithmetic', defaultLabel: 'Arithmetic', icon: 'symbol-operator', category: 'compute' },
  { kind: 'comparator', labelKey: 'scenario.nodes.comparator', defaultLabel: 'Comparator', icon: 'equals', category: 'compute' },
  { kind: 'boolean', labelKey: 'scenario.nodes.boolean', defaultLabel: 'Boolean', icon: 'symbol-boolean', category: 'compute' },
  { kind: 'object', labelKey: 'scenario.nodes.object', defaultLabel: 'Object', icon: 'symbol-namespace', category: 'compute' },
  { kind: 'setVariable', labelKey: 'scenario.nodes.setVariable', defaultLabel: 'Set variable', icon: 'symbol-variable', category: 'compute' },
  { kind: 'getVariable', labelKey: 'scenario.nodes.getVariable', defaultLabel: 'Get variable', icon: 'symbol-variable', category: 'compute' },
  { kind: 'transform', labelKey: 'scenario.nodes.transform', defaultLabel: 'Transform template', icon: 'symbol-string', category: 'compute' },
  // Utilities
  { kind: 'log', labelKey: 'scenario.nodes.log', defaultLabel: 'Log', icon: 'output', category: 'utility' },
  { kind: 'assert', labelKey: 'scenario.nodes.assert', defaultLabel: 'Assert', icon: 'verified', category: 'utility' }
]

const byKind = new Map(SCENARIO_NODE_CATALOGUE.map((m) => [m.kind, m]))

/** Catalogue metadata for a kind (falls back to a generic entry). */
export function scenarioNodeMeta(kind: ScenarioNodeKind): ScenarioNodeKindMeta {
  return byKind.get(kind) ?? { kind, labelKey: `scenario.nodes.${kind}`, defaultLabel: kind, icon: 'circle-outline', category: 'utility' }
}
